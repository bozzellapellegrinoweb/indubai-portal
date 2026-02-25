-- 1. Fix Giuseppe role
UPDATE profiles SET role = 'mini_admin' WHERE full_name ILIKE '%giuseppe%';

-- 2. Recreate FK as DEFERRABLE INITIALLY DEFERRED
-- This lets the trigger insert into profiles within the same transaction
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE profiles ADD CONSTRAINT profiles_id_fkey 
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

-- 3. Recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    'staff'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
