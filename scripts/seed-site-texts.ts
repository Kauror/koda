import { loadEnv } from "./env";

loadEnv();

async function main() {
  const [{ prisma }, { seedMissingSiteTexts }] = await Promise.all([
    import("../src/lib/db"),
    import("../src/lib/site-texts"),
  ]);
  const overwrite = process.argv.includes("--overwrite");
  if (overwrite) {
    console.log("[site-texts] --overwrite enabled: default values will replace edited values.");
  }

  const result = await seedMissingSiteTexts({ overwrite });
  console.log(
    `[site-texts] created=${result.created} updated=${result.updated} skipped=${result.skipped}`
  );
  await prisma.$disconnect().catch(() => {});
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
