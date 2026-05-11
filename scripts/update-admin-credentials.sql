-- Обновить одного активного администратора (самый ранний по created_at).
-- Пароль задан bcrypt-хэшем (как в backend hash_password); plaintext в репозитории не хранится.
--
-- Выполнение на production (пример):
--   docker exec -i wms_prod_db psql -U postgres -d app < scripts/update-admin-credentials.sql
--
-- Проверка: SELECT id, email, role FROM users WHERE role = 'admin' AND COALESCE(is_deleted,0)=0;

UPDATE users
SET
  email = 'admin@pack-men.ru',
  password_hash = '$2b$12$OyLf7dsW6xF862EwFKBHlOZXULXvyxZkP.KlrjbQV6rYA7frrSHpW'
WHERE id = (
  SELECT id
  FROM users
  WHERE role = 'admin'
    AND COALESCE(is_deleted, 0) = 0
  ORDER BY created_at ASC
  LIMIT 1
);
