// DUBBELRÄKNINGSVAKTEN (KRAV-6) — prövad direkt, inte bara indirekt.
//
// Vakten i `unclaimedCreditBalance` är den mekanism som ska hindra det farligaste
// felet i likviditetsprognosen: att samma krona räknas i två källor. Fram till nu
// skyddades den bara av summalikheten i liquiditySources.test.ts ("26xx räknas i
// momsen och ingen annanstans") — en indirekt mätning som passerar även om vakten
// aldrig löser ut. Testerna nedan anropar vakten själv: ett intervall som rör
// taxLiability:s konton SKA kasta, ett som inte gör det SKA gå igenom.
import { describe, expect, it } from 'vitest';
import { unclaimedCreditBalance, type AccountLine } from '../src/services/reports.js';

const line = (account_number: number, credit_ore: number, debit_ore = 0): AccountLine => ({
  account_number,
  name: `Konto ${account_number}`,
  account_type: 'liability',
  debit_ore,
  credit_ore,
  balance_ore: debit_ore - credit_ore,
});

const balance: AccountLine[] = [
  line(2650, 1_000_00),   // momsredovisningskonto — ingår i källan "moms"
  line(2710, 500_00),     // personalens källskatt — ingår i källan "agi"
  line(2999, 700_00),     // fritt konto, ingen statutär källa gör anspråk på det
  line(2890, 300_00, 100_00),
];

describe('dubbelräkningsvakten i likviditetsprognosen', () => {
  it('en källa som läser 2650 kastar — beloppet ingår redan i "moms"', () => {
    expect(() => unclaimedCreditBalance(balance, 2650, 2650, 'egen_momskalla'))
      .toThrow(/ingår redan i källan "moms"/);
    // Även den som bara SNUDDAR vid intervallet fångas — vakten testar överlapp,
    // inte likhet. 2600–2699 är momsens, 2710–2719 och 2730–2739 är AGI:ns.
    expect(() => unclaimedCreditBalance(balance, 2400, 2650, 'brett_intervall'))
      .toThrow(/dubbelräkning/);
    expect(() => unclaimedCreditBalance(balance, 2715, 2725, 'delvis_agi'))
      .toThrow(/ingår redan i källan "agi"/);
    expect(() => unclaimedCreditBalance(balance, 2730, 2739, 'arbetsgivaravgift'))
      .toThrow(/ingår redan i källan "agi"/);
  });

  it('en källa som läser 2999 går igenom och ger kreditsaldot', () => {
    const r = unclaimedCreditBalance(balance, 2999, 2999, 'ovrig_skuld');
    expect(r.amount_ore).toBe(700_00);
    expect(r.accounts).toEqual([2999]);
  });

  it('de källor prognosen faktiskt använder ligger utanför de anspråkade intervallen', () => {
    // Regressionsspärr: skulle någon flytta en av dem in i 26xx/271x/273x
    // kastar prognosen vid varje anrop i stället för att räkna fel i tysthet.
    expect(() => unclaimedCreditBalance(balance, 2920, 2920, 'semesterloner_2920')).not.toThrow();
    expect(() => unclaimedCreditBalance(balance, 2890, 2899, 'ovriga_kortfristiga_2890')).not.toThrow();
    expect(() => unclaimedCreditBalance(balance, 2510, 2510, 'skattekonto_2510')).not.toThrow();
    // 289x: kredit − debet, och bara konton med nettosaldo listas.
    expect(unclaimedCreditBalance(balance, 2890, 2899, 'ovriga_kortfristiga_2890')).toEqual({
      amount_ore: 200_00, accounts: [2890],
    });
  });
});
