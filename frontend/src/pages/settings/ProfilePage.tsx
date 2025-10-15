import { useState, useEffect } from 'react';
import { useCurrentUser, useUpdateUser, useChangePassword } from '../../hooks/useUser';

export default function ProfilePage() {
  const { data: user, isLoading } = useCurrentUser();
  const updateUser = useUpdateUser();
  const changePassword = useChangePassword();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Set initial values when user data loads
  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setPhone(user.phone || '');
    }
  }, [user]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setError('');

    try {
      await updateUser.mutateAsync({ name, phone });
      setMessage('Profile updated successfully');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update profile');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setError('');

    try {
      await changePassword.mutateAsync({
        current_password: currentPassword,
        new_password: newPassword,
      });
      setMessage('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to change password');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6 text-gray-900">Profile Settings</h1>

      {message && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-800 rounded-lg">
          {message}
        </div>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-800 rounded-lg">
          {error}
        </div>
      )}

      {/* Profile Form */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-900">Personal Information</h2>
        <form onSubmit={handleUpdateProfile}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2 text-gray-700">
              Email
            </label>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-700"
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2 text-gray-700">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2 text-gray-700">
              Phone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <button
            type="submit"
            disabled={updateUser.isPending}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {updateUser.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>

      {/* Change Password Form */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4 text-gray-900">Change Password</h2>
        <form onSubmit={handleChangePassword}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2 text-gray-700">
              Current Password
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2 text-gray-700">
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              minLength={8}
              required
            />
            <p className="mt-1 text-sm text-gray-600">
              Password must be at least 8 characters
            </p>
          </div>

          <button
            type="submit"
            disabled={changePassword.isPending}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {changePassword.isPending ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>

      {/* User Info */}
      <div className="mt-6 bg-gray-50 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Account Information</h3>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-600">Role:</dt>
          <dd className="text-gray-900 font-medium">{user?.role}</dd>
          <dt className="text-gray-600">Status:</dt>
          <dd className="text-gray-900 font-medium">
            {user?.is_active ? 'Active' : 'Inactive'}
          </dd>
          <dt className="text-gray-600">Email Verified:</dt>
          <dd className="text-gray-900 font-medium">
            {user?.email_verified ? 'Yes' : 'No'}
          </dd>
          <dt className="text-gray-600">Member Since:</dt>
          <dd className="text-gray-900 font-medium">
            {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
          </dd>
        </dl>
      </div>
    </div>
  );
}
