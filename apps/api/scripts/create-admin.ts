// Create or update an admin login from the command line.
//
//   npm exec -w @voter/api -- tsx scripts/create-admin.ts <email> <password> [role] [name]
//
// role: super_admin (default) | developer | constituency_admin (needs an assembly; use the dashboard)
// Prints the SQL-equivalent upsert it performed, never the password.
import 'dotenv/config';

import { hashPassword } from '../src/lib/password.js';
import { prisma } from '../src/prisma.js';

const [email, password, role = 'super_admin', name] = process.argv.slice(2);

if (!email || !password) {
  console.error('usage: tsx scripts/create-admin.ts <email> <password> [super_admin|developer] [name]');
  process.exit(1);
}
if (role !== 'super_admin' && role !== 'developer') {
  console.error('role must be super_admin or developer');
  process.exit(1);
}
if (password.length < 8) {
  console.error('password must be at least 8 characters');
  process.exit(1);
}

const passwordHash = await hashPassword(password);
const admin = await prisma.adminUser.upsert({
  where: { email: email.toLowerCase() },
  update: { passwordHash, role, isActive: true, ...(name ? { name } : {}) },
  create: { email: email.toLowerCase(), passwordHash, role, name: name ?? (role === 'developer' ? 'Developer' : 'Super Admin') },
});
console.log(`${admin.role} ${admin.email} (${admin.id}) is ready`);
await prisma.$disconnect();
