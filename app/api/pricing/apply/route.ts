/** Manual applications are not verified payments. */
export async function POST() {
  return Response.json({ error: "人工付款登记已停止，请通过会员页使用支付宝付款" },
    { status: 410, headers: { "Cache-Control": "no-store" } });
}
