-- Create default admin user if not exists
INSERT IGNORE INTO User (id, username, password, role, createdAt, updatedAt)
VALUES (UUID(), 'admin', '$2a$10$BitC0d3.g(placeholder...replaced by actual hash)', 'ADMIN', NOW(), NOW());