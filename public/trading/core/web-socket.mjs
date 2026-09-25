export default class Socket {
 static OPEN=1;
 constructor(url){this.socket=new WebSocket(url);this.socket.binaryType='arraybuffer';}
 get readyState(){return this.socket.readyState;}
 on(type,fn){this.socket.addEventListener(type,event=>{if(type==='message')fn(typeof event.data==='string'?event.data:new TextDecoder().decode(event.data));else fn(event);});}
 send(x){this.socket.send(x);} close(){this.socket.close();} terminate(){this.socket.close();} ping(){}
}
