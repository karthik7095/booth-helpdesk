import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

import { hashPassword } from '../src/lib/password.js';
import { generateUniquePin } from '../src/lib/pin.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.SUPERADMIN_EMAIL ?? 'admin@voter.local';
  const password = process.env.SUPERADMIN_PASSWORD ?? 'Admin@12345';

  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: { isActive: true },
    create: {
      email,
      name: process.env.SUPERADMIN_NAME ?? 'Super Admin',
      passwordHash: await hashPassword(password),
    },
  });

  const assembly = await prisma.assembly.upsert({
    where: { assemblyNo: 241 },
    update: {},
    create: { assemblyNo: 241, nameEn: 'Gandhinagar South', stateCode: 'S29', code: 'GD' },
  });

  const existingPin = await prisma.accessPin.findFirst({ where: { assemblyId: assembly.id } });

  const pin =
    existingPin ??
    (await prisma.accessPin.create({
      data: {
        pin: await generateUniquePin(assembly, async (candidate) =>
          (await prisma.accessPin.findUnique({ where: { pin: candidate } })) !== null,
        ),
        label: 'Demo PIN — whole constituency',
        assemblyId: assembly.id,
        partNos: [],
        createdById: admin.id,
      },
    }));

  const voters = [
    { srNo: 1, eFirstName: 'Anita', eMiddleName: 'Sharma', lFirstName: 'અનિતા', lMiddleName: 'શર્મા', sex: 'F', age: 34, vcardId: 'ABC1234567', houseNo: '12/A' },
    { srNo: 2, eFirstName: 'Ravi', eMiddleName: 'Kumar', lFirstName: 'રવિ', lMiddleName: 'કુમાર', sex: 'M', age: 41, vcardId: 'ABC1234568', houseNo: '12/A' },
    { srNo: 3, eFirstName: 'Meena', eMiddleName: 'Patel', lFirstName: 'મીના', lMiddleName: 'પટેલ', sex: 'F', age: 58, vcardId: 'ABC1234569', houseNo: '15' },
  ];

  for (const voter of voters) {
    await prisma.voter.upsert({
      where: {
        assemblyNo_partNo_srNo: { assemblyNo: assembly.assemblyNo, partNo: 1, srNo: voter.srNo },
      },
      update: {},
      create: {
        ...voter,
        assemblyId: assembly.id,
        assemblyNo: assembly.assemblyNo,
        partNo: 1,
        eAssemblyName: assembly.nameEn,
        eVillage: 'Sector 12',
        eBoothAddress: 'Government High School, Room 3',
        lAddress: 'સેક્ટર ૧૨, ગાંધીનગર',
      },
    });
  }

  console.log(`Super admin: ${admin.email} / ${password}`);
  console.log(`Constituency ${assembly.assemblyNo} (${assembly.nameEn}) with ${voters.length} voters.`);
  console.log(`Access PIN: ${pin.pin}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
