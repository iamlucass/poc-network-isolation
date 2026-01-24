import index from "./static/index.html";

/**
 * Registers a callback to be executed when a signal is received
 *
 * @param fn Callback function to be executed
 */
function shutdown(fn: () => void | Promise<void>) {
  const events = ["SIGINT", "SIGTERM"] as const;

  for (const event of events) {
    process.once(event, () => {
      console.info("[%s] Shutting down...", event);

      Promise.resolve()
        .then(() => fn())
        .catch((err) => {
          console.error("Error while shutting down server", err);
        })
        .then(() => {
          console.info("Exiting...");
          process.exit(0);
        });
    });
  }
}

/**
 * Serializes a caught error into a JSON response
 *
 * @param err Caught error
 * @returns Response object
 */
function errorResponse(err: unknown): Response {
  return Response.json(
    { err: Error.isError(err) ? err.message : "Unknown error" },
    { status: 500, statusText: "Internal Server Error" },
  );
}

/**
 * Proxies the given URL trimming content-encoding and content-length headers
 * to prevent decoding issues on client
 *
 * @param url URL to be proxied
 * @returns Proxied response
 */
async function proxy(url: string): Promise<Response> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 1500);

  shutdown(() => {
    abort.abort();
    clearTimeout(timeout);
  });

  console.info("Proxying %j", url);

  try {
    const res = await fetch(url, { signal: abort.signal });
    const headers = new Headers(res.headers);

    headers.delete("content-encoding");
    headers.delete("content-length");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  } catch (err) {
    console.error("Failed to proxy %j", url, err);

    return Response.json(
      { err: Error.isError(err) ? err.message : "Unknown error" },
      { status: 500, statusText: "Internal Server Error" },
    );
  }
}

/**
 * Starts the server
 */
async function main() {
  const server = Bun.serve({
    port: 3000,
    routes: {
      "/google": () => proxy("https://google.com").catch(errorResponse),
      "/github": () => proxy("http://github.lokal").catch(errorResponse),
      "/stripe": () => proxy("http://stripe.lokal").catch(errorResponse),
      "/": index,
    },
  });

  shutdown(async () => {
    await server.stop(true);
  });

  console.info("Server listening on %j", server.url);
}

main().catch((err) => {
  console.error("Error starting server", err);
  process.exit(1);
});
