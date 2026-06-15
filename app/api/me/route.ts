import { NextResponse } from "next/server";
import { isConnected, fetchUserInfo } from "@/lib/googlehealth";

export async function GET() {
  if (!isConnected()) return NextResponse.json({ name: "", picture: "" });
  const info = await fetchUserInfo();
  return NextResponse.json(info ?? { name: "", picture: "" });
}
