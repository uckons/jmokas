const pool = require('../db/pool');

async function createAuditLog({ userId, action, entityType, entityId, oldValues, newValues, ipAddress, userAgent, description }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId || null,
        action,
        entityType,
        entityId || null,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ipAddress || null,
        userAgent || null,
        description || null
      ]
    );
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

module.exports = { createAuditLog };
