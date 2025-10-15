import { query } from '../config/database.js';
import bcrypt from 'bcrypt';
import { User, CreateUserDto, UpdateUserDto } from '../types/user.types.js';

export const getUserById = async (userId: string): Promise<User | null> => {
  const result = await query(
    `SELECT id, email, name, phone, avatar_url, role, is_active,
            email_verified, two_factor_enabled, last_login, created_at, updated_at
     FROM users WHERE id = $1`,
    [userId]
  );

  return result.rows[0] || null;
};

export const getUserByEmail = async (email: string): Promise<User | null> => {
  const result = await query(
    `SELECT id, email, name, phone, avatar_url, role, is_active,
            email_verified, two_factor_enabled, last_login, created_at, updated_at
     FROM users WHERE email = $1`,
    [email]
  );

  return result.rows[0] || null;
};

export const getAllUsers = async (companyId?: string): Promise<User[]> => {
  let queryText = `
    SELECT DISTINCT u.id, u.email, u.name, u.phone, u.avatar_url, u.role,
           u.is_active, u.email_verified, u.two_factor_enabled,
           u.last_login, u.created_at, u.updated_at
    FROM users u
  `;

  const params: any[] = [];

  if (companyId) {
    queryText += `
      INNER JOIN user_companies uc ON u.id = uc.user_id
      WHERE uc.company_id = $1
    `;
    params.push(companyId);
  }

  queryText += ` ORDER BY u.created_at DESC`;

  const result = await query(queryText, params);
  return result.rows;
};

export const updateUser = async (
  userId: string,
  updates: UpdateUserDto
): Promise<User> => {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (updates.name !== undefined) {
    fields.push(`name = $${paramCount}`);
    values.push(updates.name);
    paramCount++;
  }

  if (updates.phone !== undefined) {
    fields.push(`phone = $${paramCount}`);
    values.push(updates.phone);
    paramCount++;
  }

  if (updates.avatar_url !== undefined) {
    fields.push(`avatar_url = $${paramCount}`);
    values.push(updates.avatar_url);
    paramCount++;
  }

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(userId);

  const result = await query(
    `UPDATE users
     SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount}
     RETURNING id, email, name, phone, avatar_url, role, is_active,
               email_verified, two_factor_enabled, last_login, created_at, updated_at`,
    values
  );

  return result.rows[0];
};

export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  // Get current password hash
  const result = await query(
    'SELECT password_hash FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error('User not found');
  }

  // Verify current password
  const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
  if (!valid) {
    throw new Error('Current password is incorrect');
  }

  // Hash new password
  const newPasswordHash = await bcrypt.hash(newPassword, 12);

  // Update password
  await query(
    'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [newPasswordHash, userId]
  );
};

export const deactivateUser = async (userId: string): Promise<void> => {
  await query(
    'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [userId]
  );
};

export const activateUser = async (userId: string): Promise<void> => {
  await query(
    'UPDATE users SET is_active = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [userId]
  );
};

export const deleteUser = async (userId: string): Promise<void> => {
  // Soft delete - deactivate instead of actual deletion
  await deactivateUser(userId);
};

export const updateLastLogin = async (userId: string): Promise<void> => {
  await query(
    'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
    [userId]
  );
};
