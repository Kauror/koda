import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { adminActor } from "@/lib/admin-content-overrides";
import { requireAdmin, redirectTo } from "@/lib/adminRoute";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const REPORT_PATH = "data/import/reports/import-report.json";

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function readImportReport(): unknown {
  const path = resolve(process.cwd(), REPORT_PATH);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const run = await prisma.adminPublishRun.create({
    data: { kind: "data_package_import", status: "started", actor: adminActor() },
  });

  try {
    const { stdout, stderr } = await execFileAsync(npmCommand(), ["run", "import:merge-ready"], {
      cwd: process.cwd(),
      timeout: 1000 * 60 * 15,
      maxBuffer: 1024 * 1024 * 8,
    });
    const report = readImportReport();
    await prisma.adminPublishRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        reportJson: report as Prisma.InputJsonValue,
        validationJson: { stdout: stdout.slice(-4000), stderr: stderr.slice(-4000) },
      },
    });
    return redirectTo(req, "/admin/data-bundle?published=1");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.adminPublishRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorSummary: message.slice(0, 4000),
        reportJson: readImportReport() as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ error: "Package publish failed", details: message }, { status: 500 });
  }
}
