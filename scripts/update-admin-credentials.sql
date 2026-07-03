-- Обновить одного активного администратора (самый ранний по created_at).
-- Пароль задаётся bcrypt-хэшем (как в backend hash_password); plaintext в репозитории не хранится.
--
-- ВНИМАНИЕ: реальные email/хэш в репозиторий не коммитим — это раскрывает логин админа
-- и даёт офлайн-цель для брутфорса. Подставьте значения при выполнении, напр.:
--   HASH=$(python -c "import bcrypt;print(bcrypt.hashpw(b'СИЛЬНЫЙ_ПАРОЛЬ', bcrypt.gensalt()).decode())")
--   sed "s|__ADMIN_EMAIL__|admin@example.com|; s|__ADMIN_PASSWORD_HASH__|$HASH|" scripts/update-admin-credentials.sql \
--     | docker exec -i wms_prod_db psql -U postgres -d app
--
-- Проверка: SELECT id, email, role FROM users WHERE role = 'admin' AND COALESCE(is_deleted,0)=0;

UPDATE users
SET
  email = '__ADMIN_EMAIL__',
  password_hash = '__ADMIN_PASSWORD_HASH__'
WHERE id = (
  SELECT id
  FROM users
  WHERE role = 'admin'
    AND COALESCE(is_deleted, 0) = 0
  ORDER BY created_at ASC
  LIMIT 1
);
