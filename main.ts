import { serve } from "https://deno.land/std/http/server.ts" 

// 定义一个const变量，用来决定是否开启调试模式
const DEBUG = true;

// 定义一个自定义的log函数，用来代替console.log
function log(...args) {
  if (DEBUG) console.log(...args);
}

// 创建WebSocket连接的函数
async function createWebSocket(url: string) {
  const ws = new WebSocket(url);
  // 等待连接打开
  await new Promise((resolve) => ws.addEventListener("open", resolve));
  return ws;
}

// 处理WebSocket事件的函数
function handleWebSocketEvents(ws1: WebSocket, ws2: WebSocket) {
  // Proxy messages from one WebSocket connection to another
  ws1.addEventListener("message", (message: any) => {
    try {
      ws2.send(message.data);
    } catch (e) {
      if (e instanceof Deno.errors.BrokenPipe) {
        log("Broken pipe error, trying to reconnect...");
        ws2 = createWebSocket(ws2.url);
      } else {
        throw e;
      }
    }
  });
  // Close one WebSocket connection when another is closed
  ws1.addEventListener("close", (e) => {
    ws2.close(1000, e.reason);
  });
  // Handle errors and close both WebSocket connections
  ws1.addEventListener("error", (e) => {
    log(e);
    ws1.close(1000, "Bad Request");
    ws2.close(1000, "Bad Request");
  });
}
serve(async (req: Request) => {
  const { origin, href } = new URL(req.url);

  //const targetUrl = href.replace(`${origin}/`, '');
  const magic = "CrayonSweetie";
  let targetUrl = href.slice(origin.length + 1);
  if (targetUrl.slice(0, magic.length + 1) === magic + "/") { 
    targetUrl = targetUrl.slice(magic.length + 1); 
  } else {
    return await Failover(req); 
  }

  let urlObj: any;
  try {
    urlObj = new URL(targetUrl);
  } catch (e) {
    log(e.message);
  }
  if (['http:', 'https:'].includes(urlObj?.protocol)) {
    const upgrade = req.headers.get("upgrade") || "";
    if (upgrade.toLowerCase() != "websocket") {
      return await fetch(targetUrl, req);
    }
    const protocol = urlObj.protocol === "https:" ? 'wss:' : 'ws:';
    const upstream = await createWebSocket(`${protocol}//${urlObj.host}${urlObj.pathname}`);
    const { socket: downstream, response } = Deno.upgradeWebSocket(req, { idleTimeout: 60000 }); // 增加idleTimeout参数
    try {
      await createWebSocket(`${protocol}//${urlObj.host}${urlObj.pathname}`);
      handleWebSocketEvents(upstream, downstream);
      handleWebSocketEvents(downstream, upstream);
      return response;
    } catch (e) {
      response.close();
      log(e);
      const res = { status: 500, headers, body: '500 Internal Server Error' }
      response.writeHead(500, res.headers);
      response.end(res.body);
    }
  } else {
    return Failover(req);
  }

}, { port: Deno.env.get("PORT") })

// 创建Fallback的函数
async function Failover(req: Request) {
  const url = new URL(req.url); 
  url.host = 'deno.com'; 
  try {
    return await fetch(url.toString(), req);
  } catch (e) {
    log(e.message);
    return new Response(null, {
      status: 200
    })
  }
}
