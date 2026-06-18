import { NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/auth";
import { redirectTo } from "@/lib/adminRoute";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const res = redirectTo(req, "/");
  res.cookies.delete(ADMIN_COOKIE);
  return res;
}
