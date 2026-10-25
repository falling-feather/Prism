/** Programs run in a worker owned by an opaque-origin frame, not the editor origin. */
export function createSandboxWorker(source, signal) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe"),
      channel = new MessageChannel();
    frame.sandbox = "allow-scripts";
    frame.title = "动画绘制环境";
    frame.style.display = "none";
    let connected = false,
      closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      channel.port1.postMessage({ kind: "dispose" });
      channel.port1.close();
      frame.remove();
    };
    const abort = () => {
      close();
      if (!connected) reject(Error("绘制环境初始化已取消"));
    };
    const timer = setTimeout(() => {
      close();
      reject(Error("绘制环境初始化超时"));
    }, 10000);
    const transport = {
      onmessage: null,
      onerror: null,
      postMessage: (data) => channel.port1.postMessage(data),
      terminate: close,
    };
    channel.port1.onmessage = (event) => {
      if (event.data?.kind === "connected") {
        connected = true;
        clearTimeout(timer);
        resolve(transport);
      } else if (event.data?.kind === "worker-error") {
        const error = { message: event.data.message };
        if (connected) transport.onerror?.(error);
        else {
          close();
          reject(Error(error.message));
        }
      } else transport.onmessage?.(event);
    };
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'"><script>
      addEventListener('message',event=>{
        if(event.source!==parent||event.data?.kind!=='connect'||!event.ports[0])return;
        const port=event.ports[0];
        try{
          const url=URL.createObjectURL(new Blob([event.data.source],{type:'text/javascript'}));
          const worker=new Worker(url);
          worker.onmessage=e=>port.postMessage(e.data,e.data?.bitmap instanceof ImageBitmap?[e.data.bitmap]:[]);
          worker.onerror=e=>{e.preventDefault();port.postMessage({kind:'worker-error',message:e.message});};
          port.onmessage=e=>{if(e.data?.kind==='dispose'){worker.terminate();URL.revokeObjectURL(url);port.close();}else worker.postMessage(e.data);};
          port.start();port.postMessage({kind:'connected'});
        }catch(error){port.postMessage({kind:'worker-error',message:error.message});}
      },{once:true});
    <\/script>`;
    frame.onload = () => {
      if (!closed)
        frame.contentWindow.postMessage({ kind: "connect", source }, "*", [
          channel.port2,
        ]);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    document.body.append(frame);
  });
}
