import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { fetchUsers, fetchGlobalStats, deleteUser, setUserRole } from '../api';
import { queryKeys } from '../api/queryKeys';
import PageHeader from '../components/dashboard/PageHeader';

function AdminDashboard() {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({
    queryKey: queryKeys.adminUsers(),
    queryFn: fetchUsers,
  });
  const statsQuery = useQuery({
    queryKey: queryKeys.adminStats(),
    queryFn: fetchGlobalStats,
  });
  const invalidateAdminData = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers() });
    queryClient.invalidateQueries({ queryKey: queryKeys.adminStats() });
  };
  const deleteUserMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: invalidateAdminData,
  });
  const setUserRoleMutation = useMutation({
    mutationFn: ({ id, role }) => setUserRole(id, role),
    onSuccess: invalidateAdminData,
  });

  const users = usersQuery.data || [];
  const stats = statsQuery.data || null;
  const loading = usersQuery.isPending || statsQuery.isPending;

  const handleDelete = async (id) => {
    if (confirm('Delete user? This cannot be undone.')) {
      await deleteUserMutation.mutateAsync(id);
    }
  };

  const handleRoleChange = async (id, role) => {
    await setUserRoleMutation.mutateAsync({ id, role });
  };

  if (loading) return <div>Loading admin data...</div>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <PageHeader 
        title="Admin Control Panel"
        subtitle="Manage users and view global system statistics"
      />

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[--color-bg-card] p-4 rounded-xl border border-[--color-border]">
            <div className="text-[--color-text-secondary] text-sm">Total Users</div>
            <div className="text-2xl font-bold">{stats.users}</div>
          </div>
          <div className="bg-[--color-bg-card] p-4 rounded-xl border border-[--color-border]">
            <div className="text-[--color-text-secondary] text-sm">Global Requests</div>
            <div className="text-2xl font-bold">{stats.totalRequests}</div>
          </div>
          <div className="bg-[--color-bg-card] p-4 rounded-xl border border-[--color-border]">
            <div className="text-[--color-text-secondary] text-sm">Avg Latency</div>
            <div className="text-2xl font-bold">{stats.avgLatencyMs}ms</div>
          </div>
          <div className="bg-[--color-bg-card] p-4 rounded-xl border border-[--color-border]">
            <div className="text-[--color-text-secondary] text-sm">Total Errors</div>
            <div className="text-2xl font-bold">{stats.errorCount}</div>
          </div>
        </div>
      )}

      <div className="bg-[--color-bg-card] rounded-xl border border-[--color-border] overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-[--color-bg-tertiary] text-[--color-text-secondary]">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[--color-border]">
            {users.map(u => (
              <tr key={u._id} className="hover:bg-[--color-bg-tertiary] transition-colors">
                <td className="px-4 py-3 flex items-center gap-3">
                  <img src={u.avatar || 'https://via.placeholder.com/32'} alt="Avatar" className="w-8 h-8 rounded-full" />
                  <span className="font-medium">{u.displayName || 'Unknown'}</span>
                </td>
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">
                  <select 
                    value={u.role} 
                    onChange={(e) => handleRoleChange(u._id, e.target.value)}
                    className="bg-[--color-bg-page] border border-[--color-border] rounded px-2 py-1"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td className="px-4 py-3">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => handleDelete(u._id)} className="text-red-500 hover:text-red-400">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}

export default AdminDashboard;
