/**
 * Drives a Next.js server action the way a browser does.
 *
 * `Next-Action: <id>` is only a hint: Next expects the multipart body the
 * `ACTION_ID_<id>` field belongs to (see `decodeAction` in next/dist/server), and
 * answers "Connection closed" without it. This reproduces the browser's exact
 * encoding — multipart, `$ACTION_ID_<id>` as a plain field, form fields after.
 *
 * Usage:
 *   node scripts/action-post.cjs <url> <actionId> <cookie> field=value...
 *
 * Kept out of the test suites: it is a debugging aid for walking the app with
 * curl, not something the app depends on.
 */
const http = require("http");

const [url, actionId, cookie, ...pairs] = process.argv.slice(2);
if (!url || !actionId || !cookie) {
  console.error("usage: node scripts/action-post.cjs <url> <actionId> <cookie> field=value...");
  process.exit(1);
}

const boundary = `----workpulse${Date.now()}`;
const escape = (value) => String(value).replace(/"/g, '\\"');

const parts = [`--${boundary}\r\nContent-Disposition: form-data; name="$ACTION_ID_${actionId}"\r\n\r\n\r\n`];
for (const pair of pairs) {
  const [name, ...rest] = pair.split("=");
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="${escape(name)}"\r\n\r\n${rest.join("=")}\r\n`,
  );
}
const body = parts.join("") + `--${boundary}--\r\n`;

const target = new URL(url);
const request = http.request(
  {
    hostname: target.hostname,
    port: target.port,
    path: target.pathname + target.search,
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": Buffer.byteLength(body),
      Cookie: cookie,
      Accept: "text/x-component",
      // Next rejects a forwarded action without these; a browser always sends them.
      Origin: target.origin,
      "Next-Router-State-Tree": encodeURIComponent('["",{"children":["app",{"children":["tasks",{"children":["__PAGE__",{}]}]}]},"/app/tasks",null,true]'),
      Referer: `${target.origin}/app/tasks`,
    },
  },
  (response) => {
    let text = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => (text += chunk));
    response.on("end", () => {
      console.log(`status ${response.statusCode} · ${text.length} bytes`);
      const error = /"error":"([^"]+)"/.exec(text);
      const message = /"message":"([^"]+)"/.exec(text);
      if (error) console.log("error:", error[1]);
      if (message) console.log("message:", message[1]);
      for (const needle of process.env.EXPECT ? process.env.EXPECT.split(",") : []) {
        console.log(`${text.includes(needle) ? "found    " : "MISSING  "} ${needle}`);
      }
    });
  },
);
request.on("error", (e) => {
  console.error("request failed:", e.message);
  process.exit(1);
});
request.write(body);
request.end();
