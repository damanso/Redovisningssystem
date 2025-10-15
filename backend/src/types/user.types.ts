export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  avatar_url?: string;
  role: 'admin' | 'user' | 'accountant' | 'viewer';
  is_active: boolean;
  email_verified: boolean;
  two_factor_enabled: boolean;
  last_login?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUserDto {
  email: string;
  password: string;
  name: string;
  phone?: string;
  role?: string;
}

export interface UpdateUserDto {
  name?: string;
  phone?: string;
  avatar_url?: string;
}

export interface ChangePasswordDto {
  current_password: string;
  new_password: string;
}
