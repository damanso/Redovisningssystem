#!/bin/bash

# FAS 4.1: Multi-Company Management - Migration Script
# This script runs the database migration for multi-company features

echo "========================================="
echo "FAS 4.1: Multi-Company Management"
echo "Database Migration Script"
echo "========================================="
echo ""

# Check if docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not in PATH"
    echo "Please install Docker and try again"
    exit 1
fi

# Check if postgres container is running
POSTGRES_CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | head -n 1)

if [ -z "$POSTGRES_CONTAINER" ]; then
    echo "❌ No PostgreSQL container found running"
    echo "Please start your PostgreSQL container with: docker-compose up -d"
    exit 1
fi

echo "✓ Found PostgreSQL container: $POSTGRES_CONTAINER"
echo ""

# Run migration
MIGRATION_FILE="database/migrations/005_multi_company_management.sql"

if [ ! -f "$MIGRATION_FILE" ]; then
    echo "❌ Migration file not found: $MIGRATION_FILE"
    exit 1
fi

echo "Running migration: $MIGRATION_FILE"
echo ""

docker exec -i "$POSTGRES_CONTAINER" psql -U postgres -d redovisning < "$MIGRATION_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================="
    echo "✅ Migration completed successfully!"
    echo "========================================="
    echo ""
    echo "New tables created:"
    echo "  - company_groups"
    echo "  - company_group_members"
    echo "  - cross_company_transactions"
    echo "  - consolidated_report_configs"
    echo ""
    echo "Views created:"
    echo "  - company_group_summary"
    echo "  - cross_company_transaction_summary"
    echo ""
    echo "You can now start using Multi-Company Management features!"
    echo ""
else
    echo ""
    echo "❌ Migration failed"
    echo "Please check the error messages above"
    exit 1
fi
