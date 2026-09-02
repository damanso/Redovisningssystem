# Drift på VPS:en (david-brain)

Kort version: **driften läser aldrig en arbetskopia.** Den läser en oföränderlig
release som pekas ut av en symlänk, och symlänken byts bara av en deploy.

## Varför det ser ut så här

Fram till 2026-09-02 pekade systemd rakt in i `/opt/redovisning` — samma katalog
som CTO-motorn checkar ut grenar i. Två gånger under en och samma kväll stod den
på en `cto/…`-gren i stället för main. Konsekvenserna var två, och den andra är
den allvarliga:

1. `git pull` vid deploy misslyckades, eftersom grenen saknade upstream.
2. **Vilken kod som kördes efter nästa omstart avgjordes av vem som råkade
   checka ut något sist.** Systemd startar om vid krasch; en omstart kunde alltså
   tyst byta vilken version av bokföringssystemet som körde.

En release ska vara ett beslut, inte en bieffekt.

## Layout

```
/opt/redovisning                      arbetskopia — CTO-motorn får göra vad den vill här
/opt/redovisning-app/shared/.env      konfiguration, ligger ALDRIG i en release
/opt/redovisning-app/releases/…       oföränderliga byggen, ett per deploy
/opt/redovisning-app/current -> …     symlänken systemd läser
/opt/redovisning-data/                uppladdade filer (låg redan utanför koden)
```

Hela `redovisning-app` ägs av `hermes` med flit: release-bytet ska inte behöva
sudo. Det enda som kräver root är `systemctl restart`.

## Kommandon

```bash
redovisning-deploy                 # deploya origin/main
redovisning-deploy <git-ref>       # deploya en specifik commit eller tagg
redovisning-deploy --rollback      # tillbaka till föregående release
```

Deployen hämtar bara git-OBJEKT från arbetskopian och exporterar trädet med
`git archive` — arbetskopians gren och filer rörs aldrig. Sedan `npm ci`,
bygge, migrationer, atomiskt symlänksbyte (`mv -T`, aldrig ett halvskrivet
mellanläge), omstart och hälsokoll. **Svarar API:t inte pekas länken tillbaka
och tjänsten startas om på den release som bevisligen fungerade.** De fem
senaste releaserna sparas; den som är i drift raderas aldrig.

Hälsokollen frågar API:t, inte systemd — enligt ADR-0003 ska en hälsokoll utöva
funktionen den vakar över. Att processen lever betyder inte att den svarar.

## Prov som gjordes vid införandet

Arbetskopian checkades ut på en påhittad gren tre commits bakåt, varefter
tjänsten startades om. Den kom upp på **exakt samma release**, med oförändrad
`WorkingDirectory` och frisk hälsokoll. Därefter kördes `redovisning-deploy`
skarpt hela vägen, och `scripts/faktura-regress.mjs` mot den nya releasen:
13 av 13 obligatoriska fakturauppgifter fanns i den genererade PDF:en.

## Om något ser konstigt ut

```bash
readlink -f /opt/redovisning-app/current          # vilken release körs
systemctl show redovisning -p WorkingDirectory    # ska vara …/current/server
ls -1 /opt/redovisning-app/releases               # tillgängliga releaser
journalctl -u redovisning -n 50
```

Den gamla unit-filen ligger kvar som
`/opt/redovisning-app/shared/redovisning.service.fore-releaser`.
