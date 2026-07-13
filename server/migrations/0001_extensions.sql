-- Extensions som schemat behöver, skapade i den ALLRA FÖRSTA migrationen så att
-- hela kedjan kan köras på en tom databas. (Gamla repot krävde pg_trgm i
-- 006_articles.sql utan att någonsin skapa den — färsk databas gick inte att sätta upp.)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Applikationsrollen: API:t ansluter som "app" — icke-superuser och inte
-- tabellägare, vilket är förutsättningen för att Row Level Security tvingas.
-- Lösenord sätts utanför migrationerna (ALTER ROLE app PASSWORD '...') i miljöer
-- som kräver lösenordsinloggning.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app LOGIN;
  END IF;
END
$$;
