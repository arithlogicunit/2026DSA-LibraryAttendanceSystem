// Supabase connection (the anon key is safe in front-end code; RLS protects the data).
// NEVER put the service_role key here.
const SUPABASE_URL = "https://uijfacbqchzrfbdpqlyl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpamZhY2JxY2h6cmZiZHBxbHlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NjgwNzUsImV4cCI6MjEwNzA0NDA3NX0.NsvCHZhpTOpcK8HOURZ05gPEDTHVbrkMKL2CSEJu19c";

// "db" is the client the rest of the code will use to talk to Supabase.
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);