/**
 * FAS 4.1: Multi-Company Management
 * Company Groups Management Page
 */

import React, { useState } from 'react';
import {
  useCompanyGroups,
  useCreateCompanyGroup,
  useDeleteCompanyGroup
} from '../hooks/useCompanyGroup';

const CompanyGroupsPage: React.FC = () => {
  const { data: groups = [], isLoading } = useCompanyGroups();
  const createGroup = useCreateCompanyGroup();
  const deleteGroup = useDeleteCompanyGroup();

  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: '#3b82f6'
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createGroup.mutateAsync(formData);
      setFormData({ name: '', description: '', color: '#3b82f6' });
      setIsCreating(false);
    } catch (error) {
      console.error('Failed to create group:', error);
    }
  };

  const handleDelete = async (groupId: string) => {
    if (!confirm('Are you sure you want to delete this group?')) return;
    try {
      await deleteGroup.mutateAsync(groupId);
    } catch (error) {
      console.error('Failed to delete group:', error);
    }
  };

  if (isLoading) {
    return <div className="page-loading">Loading company groups...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Company Groups</h1>
          <p>Organize your companies into groups for easier management</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => setIsCreating(true)}
        >
          Create Group
        </button>
      </div>

      {isCreating && (
        <div className="card">
          <h2>Create New Group</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Group Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>Color</label>
              <input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-primary" disabled={createGroup.isPending}>
                {createGroup.isPending ? 'Creating...' : 'Create Group'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setIsCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="groups-grid">
        {groups.map((group) => (
          <div key={group.id} className="group-card">
            <div className="group-header">
              <div className="group-color" style={{ backgroundColor: group.color || '#3b82f6' }} />
              <div className="group-info">
                <h3>{group.name}</h3>
                {group.description && <p>{group.description}</p>}
              </div>
            </div>
            <div className="group-stats">
              <span>{group.company_count} {group.company_count === 1 ? 'company' : 'companies'}</span>
            </div>
            <div className="group-actions">
              <button className="btn-text">View Details</button>
              <button
                className="btn-danger-text"
                onClick={() => handleDelete(group.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {groups.length === 0 && !isCreating && (
        <div className="empty-state">
          <p>No company groups yet. Create your first group to get started!</p>
        </div>
      )}

      <style>{`
        .page-container {
          padding: 24px;
          max-width: 1200px;
          margin: 0 auto;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 24px;
        }

        .page-header h1 {
          margin: 0 0 8px 0;
          font-size: 24px;
          font-weight: 600;
        }

        .page-header p {
          margin: 0;
          color: #6b7280;
        }

        .card {
          background: white;
          border-radius: 8px;
          padding: 24px;
          margin-bottom: 24px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .card h2 {
          margin: 0 0 16px 0;
          font-size: 18px;
          font-weight: 600;
        }

        .form-group {
          margin-bottom: 16px;
        }

        .form-group label {
          display: block;
          margin-bottom: 6px;
          font-size: 14px;
          font-weight: 500;
        }

        .form-group input,
        .form-group textarea {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
        }

        .form-actions {
          display: flex;
          gap: 12px;
          margin-top: 20px;
        }

        .btn-primary {
          padding: 8px 16px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }

        .btn-primary:hover {
          background: #2563eb;
        }

        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-secondary {
          padding: 8px 16px;
          background: white;
          color: #374151;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }

        .btn-secondary:hover {
          background: #f9fafb;
        }

        .btn-text {
          padding: 4px 8px;
          background: none;
          color: #3b82f6;
          border: none;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }

        .btn-text:hover {
          text-decoration: underline;
        }

        .btn-danger-text {
          padding: 4px 8px;
          background: none;
          color: #ef4444;
          border: none;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }

        .btn-danger-text:hover {
          text-decoration: underline;
        }

        .groups-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 16px;
        }

        .group-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 16px;
        }

        .group-header {
          display: flex;
          gap: 12px;
          margin-bottom: 12px;
        }

        .group-color {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          flex-shrink: 0;
        }

        .group-info h3 {
          margin: 0 0 4px 0;
          font-size: 16px;
          font-weight: 600;
        }

        .group-info p {
          margin: 0;
          font-size: 14px;
          color: #6b7280;
        }

        .group-stats {
          padding: 8px 0;
          border-top: 1px solid #e5e7eb;
          border-bottom: 1px solid #e5e7eb;
          margin-bottom: 12px;
          font-size: 14px;
          color: #6b7280;
        }

        .group-actions {
          display: flex;
          justify-content: space-between;
        }

        .empty-state {
          text-align: center;
          padding: 48px;
          color: #6b7280;
        }

        .page-loading {
          text-align: center;
          padding: 48px;
          color: #6b7280;
        }
      `}</style>
    </div>
  );
};

export default CompanyGroupsPage;
