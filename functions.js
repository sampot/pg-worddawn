export default {
  async fetch(request) {
    return Response.json({
      ok: true,
      name: "pg-worddawn",
      path: new URL(request.url).pathname,
    });
  },
};
