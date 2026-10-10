// Staff Auth helpers (Supabase Auth). Staff ID is mapped to an internal email.
function cleanStaffId(value) {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

const STAFF_EMAIL_DOMAINS = ["library.local", "nu-dasma.edu.ph"];

function staffEmail(staffId, domain = STAFF_EMAIL_DOMAINS[0]) {
  return `${cleanStaffId(staffId).toLowerCase()}@${domain}`;
}

// Sign up. The database trigger creates the profile with status "pending".
async function signUpStaff(staffId, fullName, password) {
  const id = cleanStaffId(staffId);
  const { error } = await db.auth.signUp({
    email: staffEmail(id),
    password,
    options: { data: { staff_id: id, full_name: String(fullName ?? "").trim() } }
  });
  await db.auth.signOut(); // a pending account must not stay signed in
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Account created. Waiting for admin approval." };
}

// Log in. Only active profiles are let through.
async function loginStaff(staffId, password) {
    let data = null;
  for (const domain of STAFF_EMAIL_DOMAINS) {
    const attempt = await db.auth.signInWithPassword({
      email: staffEmail(staffId, domain),
      password
    });
    if (!attempt.error) { data = attempt.data; break; }
  }
  if (!data) return { ok: false, message: "Wrong Staff ID or password." };

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("staff_id, full_name, role, status")
    .eq("id", data.user.id)
    .single();

  if (profileError || !profile) {
    await db.auth.signOut();
    return { ok: false, message: "Could not load your account. Please try again." };
  }
  if (profile.status === "pending") {
    await db.auth.signOut();
    return { ok: false, message: "Waiting for admin approval." };
  }
  if (profile.status !== "active") {
    await db.auth.signOut();
    return { ok: false, message: "This account was not approved. Contact the library admin." };
  }
  return { ok: true, profile };
}
