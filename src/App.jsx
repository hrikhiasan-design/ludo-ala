import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ══════════════════════════════════════════════
// SUPABASE CONFIG
// ══════════════════════════════════════════════
const SUPABASE_URL = "https://avxfmrdtdmisiuccfxpu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2eGZtcmR0ZG1pc2l1Y2NmeHB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MzYwODEsImV4cCI6MjA5MDUxMjA4MX0.kwEsph6eDgVzDipSKqZQzTX8Ffs6XBpyWGsw9QRbWjU";

// ══════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════
const CELL_SIZE = 36;
const SAFE = [1,9,14,22,27,35,40,48];
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const KILL_PTS = 10, FINISH_PTS = 50, WIN_PTS = 200;
const BOARD_SIZE = 15;

const PLAYERS = [
  { id:0, name:"Red",    color:"#E63946", light:"#FF8FA3", dark:"#9B1C24", start:1,  emoji:"🔴" },
  { id:1, name:"Green",  color:"#2DC653", light:"#90E0A0", dark:"#1A7A32", start:14, emoji:"🟢" },
  { id:2, name:"Yellow", color:"#FFD60A", light:"#FFF176", dark:"#B89A00", start:27, emoji:"🟡" },
  { id:3, name:"Blue",   color:"#4361EE", light:"#93C5FD", dark:"#1A3AAA", start:40, emoji:"🔵" },
];

const AVATAR_CATS = {
  "👑 Royals":  ["👸","🤴","🧕","🫅"],
  "🧑 People":  ["🧑‍🦱","🧔","👩‍🦰","🧑‍🦳"],
  "🦸 Heroes":  ["🦸","🦹","🧙","🧚"],
  "😎 Faces":   ["😎","🤩","😈","🤠"],
  "🐯 Animals": ["🦁","🐯","🦊","🐸"],
};
const ALL_AVS = Object.values(AVATAR_CATS).flat();
const REACTIONS = ["😍","😂","😡","😢","🔥","👏","💀","🏆","💪","🎉","😎","🤡"];

// ══════════════════════════════════════════════
// BOARD PATH
// ══════════════════════════════════════════════
function cellToPos(c) {
  const p=[
    [14,6],[13,6],[12,6],[11,6],[10,6],[9,6],
    [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0],
    [6,1],[6,2],[6,3],[6,4],[6,5],
    [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],
    [1,8],[2,8],[3,8],[4,8],[5,8],
    [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],
    [8,13],[8,12],[8,11],[8,10],[8,9],
    [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],
    [13,7],[12,7],[11,7],[10,7],[9,7],
    [7,1],[7,2],[7,3],[7,4],[7,5],[7,6],
    [1,7],[2,7],[3,7],[4,7],[5,7],[6,7],
    [7,13],[7,12],[7,11],[7,10],[7,9],[7,8],
    [13,7],[12,7],[11,7],[10,7],[9,7],[7,7],
  ];
  if(c<1||c>p.length) return null;
  return p[c-1];
}

// ══════════════════════════════════════════════
// SUPABASE HELPERS
// ══════════════════════════════════════════════
let sbClient = null;
let sbChannel = null;
let sbOk = false;

async function initSB() {
  if (sbOk) return true;
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    sbClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    sbOk = true;
    return true;
  } catch(e) {
    console.error("Supabase init error:", e);
    return false;
  }
}

async function sbGet(roomCode) {
  const { data, error } = await sbClient.from("ludo_rooms").select("*").eq("code", roomCode).single();
  if (error) return null;
  return data;
}

async function sbSet(roomCode, payload) {
  const { error } = await sbClient.from("ludo_rooms").upsert({ code: roomCode, ...payload });
  if (error) throw error;
}

async function sbUpdate(roomCode, payload) {
  const { error } = await sbClient.from("ludo_rooms").update(payload).eq("code", roomCode);
  if (error) throw error;
}

async function sbDelete(roomCode) {
  await sbClient.from("ludo_rooms").delete().eq("code", roomCode);
}

// Supabase Realtime subscription using Broadcast channel
function sbSubscribe(roomCode, cb) {
  if (sbChannel) {
    sbClient.removeChannel(sbChannel);
    sbChannel = null;
  }

  // Subscribe to DB changes on the room row
  const channel = sbClient
    .channel(`room-${roomCode}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "ludo_rooms",
      filter: `code=eq.${roomCode}`,
    }, (payload) => {
      if (payload.new) cb(payload.new);
    })
    .subscribe();

  sbChannel = channel;
  return () => {
    if (channel) sbClient.removeChannel(channel);
    sbChannel = null;
  };
}

// ══════════════════════════════════════════════
// GAME LOGIC
// ══════════════════════════════════════════════
function mkPieces(){ return PLAYERS.map(()=>Array.from({length:4},(_,i)=>({cell:-1,id:i,home:false}))); }

function mkGS(n=4){
  return { pieces:mkPieces(), cur:0, dice:null, rolled:false, winner:null,
    n, log:["🎉 Game shuru! Red pehle!"], kills:[0,0,0,0],
    scores:[0,0,0,0], turns:0, start:Date.now() };
}

function getMovable(gs,pid,dice){
  const p=PLAYERS[pid];
  return gs.pieces[pid].reduce((acc,pc,i)=>{
    if(pc.home) return acc;
    if(pc.cell===-1){ if(dice===6) acc.push({pid,i,from:-1,to:p.start,entry:true,kill:false}); }
    else { const to=pc.cell+dice; if(to<=72){ const kill=hasEnemy(gs.pieces,pid,to); acc.push({pid,i,from:pc.cell,to,entry:false,kill,safe:SAFE.includes(to)}); }}
    return acc;
  },[]);
}

function hasEnemy(pieces,me,cell){
  if(SAFE.includes(cell)||cell>52) return false;
  for(let pid=0;pid<4;pid++){ if(pid===me) continue; for(const p of pieces[pid]) if(p.cell===cell) return true; }
  return false;
}

function doMove(gs,pid,i,to){
  const s=JSON.parse(JSON.stringify(gs));
  const finalCell=to>=52?100:to;
  s.pieces[pid][i].cell=finalCell;
  s.pieces[pid][i].home=to>=52;
  s.moveCount=s.moveCount||[0,0,0,0]; s.moveCount[pid]++;
  if(to>=52) s.scores[pid]+=FINISH_PTS;
  if(!SAFE.includes(to)&&to<53&&to>0){
    for(let opid=0;opid<4;opid++){
      if(opid===pid) continue;
      s.pieces[opid]=s.pieces[opid].map(p=>{ if(p.cell===to){ s.kills[pid]++; s.scores[pid]+=KILL_PTS; return{...p,cell:-1,home:false}; } return p; });
    }
  }
  if(s.pieces[pid].every(p=>p.home)){ s.winner=pid; s.scores[pid]+=WIN_PTS; }
  return s;
}

function nextTurn(gs,extra=false){
  return {...gs, dice:null, rolled:false, cur:extra?gs.cur:(gs.cur+1)%gs.n, turns:(gs.turns||0)+1 };
}

function botAI(gs,pid,dice){
  const mv=getMovable(gs,pid,dice); if(!mv.length) return null;
  return mv.find(m=>m.kill)||mv.find(m=>m.to>=52)||mv.find(m=>m.entry)||mv[0];
}

// ══════════════════════════════════════════════
// LOCAL STORAGE
// ══════════════════════════════════════════════
const ls = { get:k=>{ try{return JSON.parse(localStorage.getItem("la_"+k))||null;}catch(e){return null;} }, set:(k,v)=>{ try{localStorage.setItem("la_"+k,JSON.stringify(v));}catch(e){} } };
const loadProfile=()=>ls.get("profile");
const saveProfile=p=>ls.set("profile",p);
const defProfile=()=>({name:"Player",avatar:"👸",gamesPlayed:0,gamesWon:0,totalKills:0,totalScore:0,uid:"u_"+Math.random().toString(36).slice(2),createdAt:Date.now()});
const getLB=()=>(ls.get("lb")||[]).sort((a,b)=>b.score-a.score);
function updateLB(uid,name,avatar,score,win){ const lb=getLB(); const idx=lb.findIndex(e=>e.uid===uid); if(idx>=0){lb[idx].score+=score;lb[idx].wins=(lb[idx].wins||0)+(win?1:0);lb[idx].name=name;lb[idx].avatar=avatar;}else lb.push({uid,name,avatar,score,wins:win?1:0}); ls.set("lb",lb.slice(0,50)); }

// ══════════════════════════════════════════════
// CSS
// ══════════════════════════════════════════════
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;700;800;900&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
::-webkit-scrollbar{width:4px;} ::-webkit-scrollbar-thumb{background:rgba(255,215,0,0.3);border-radius:3px;}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@keyframes pulse{0%,100%{opacity:0.6;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes up{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes dn{from{transform:translateY(-18px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes pop{from{opacity:0;transform:scale(0.8)}to{opacity:1;transform:scale(1)}}
@keyframes confetti{0%{transform:translateY(-60px)rotate(0);opacity:1}100%{transform:translateY(100vh)rotate(700deg);opacity:0}}
@keyframes react{0%{transform:translateY(0)scale(0.5);opacity:0}30%{transform:translateY(-16px)scale(1.3);opacity:1}70%{transform:translateY(-30px)scale(1);opacity:1}100%{transform:translateY(-46px)scale(0.8);opacity:0}}
@keyframes win{0%{transform:scale(0.3)rotate(-180deg);opacity:0}60%{transform:scale(1.15)rotate(8deg);opacity:1}80%{transform:scale(0.93)rotate(-3deg)}100%{transform:scale(1)rotate(0);opacity:1}}
@keyframes glow{0%,100%{box-shadow:0 0 6px rgba(255,215,0,0.3)}50%{box-shadow:0 0 20px rgba(255,215,0,0.8)}}
@keyframes piecePulse{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}
.btnH:hover{transform:translateY(-2px)!important;filter:brightness(1.1);}
.btnH:active{transform:translateY(0)!important;}
.movable{animation:piecePulse 0.6s ease-in-out infinite!important;cursor:pointer!important;filter:drop-shadow(0 0 6px white)!important;}
`;

const T={bg:"linear-gradient(160deg,#0d0033 0%,#1a0066 40%,#0d0033 100%)",gold:"#FFD700",orange:"#FF6B35",t1:"#fff",t2:"rgba(255,255,255,0.65)",t3:"rgba(255,255,255,0.32)"};
const card={background:"rgba(255,255,255,0.05)",border:"1.5px solid rgba(255,215,0,0.2)",borderRadius:18,padding:18,backdropFilter:"blur(12px)"};
const goldTxt={background:"linear-gradient(90deg,#FFD700,#FF6B35,#FFD700)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",fontWeight:900,backgroundClip:"text"};
const inp={width:"100%",padding:"10px 13px",background:"rgba(255,255,255,0.08)",border:"1.5px solid rgba(255,215,0,0.3)",borderRadius:10,color:"#fff",fontSize:15,fontFamily:"'Baloo 2',cursive",outline:"none"};
const btnA={padding:"12px 22px",background:"linear-gradient(135deg,#FFD700,#FF6B35)",border:"none",borderRadius:13,fontSize:15,fontWeight:900,cursor:"pointer",fontFamily:"'Baloo 2',cursive",color:"#0d0033",transition:"all 0.15s"};
const btnB={padding:"11px 20px",background:"rgba(255,215,0,0.1)",border:"2px solid rgba(255,215,0,0.38)",borderRadius:13,fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"'Baloo 2',cursive",color:T.gold,transition:"all 0.15s"};
const btnC={padding:"8px 16px",background:"rgba(255,255,255,0.06)",border:"1.5px solid rgba(255,255,255,0.13)",borderRadius:11,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'Baloo 2',cursive",color:T.t2,transition:"all 0.15s"};

// ══════════════════════════════════════════════
// SMALL COMPONENTS
// ══════════════════════════════════════════════
function Particles(){
  const pts=useMemo(()=>Array.from({length:16},(_,i)=>({id:i,x:Math.random()*100,y:Math.random()*100,sz:2+Math.random()*4,op:0.1+Math.random()*0.22,dur:3+Math.random()*4,del:Math.random()*3,col:["#FFD700","#FF6B35","#E63946","#4361EE","#2DC653"][i%5]})),[]);
  return <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,overflow:"hidden"}}>{pts.map(p=><div key={p.id} style={{position:"absolute",left:`${p.x}%`,top:`${p.y}%`,width:p.sz,height:p.sz,borderRadius:"50%",background:p.col,opacity:p.op,animation:`float ${p.dur}s ${p.del}s ease-in-out infinite`}}/>)}</div>;
}

function Confetti({on}){
  const pcs=useMemo(()=>Array.from({length:50},(_,i)=>({id:i,x:Math.random()*100,col:["#FFD700","#FF6B35","#E63946","#2DC653","#4361EE","#FF69B4"][i%6],sz:6+Math.random()*8,dur:2+Math.random()*3,del:Math.random()*2,r:Math.random()>0.5?"50%":"2px"})),[]);
  if(!on) return null;
  return <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:200,overflow:"hidden"}}>{pcs.map(p=><div key={p.id} style={{position:"absolute",left:`${p.x}%`,top:-16,width:p.sz,height:p.sz,background:p.col,borderRadius:p.r,animation:`confetti ${p.dur}s ${p.del}s linear forwards`}}/>)}</div>;
}

function Toast({msg,type}){
  const bg={info:"linear-gradient(135deg,#FFD700,#FF6B35)",success:"linear-gradient(135deg,#2DC653,#00B894)",error:"linear-gradient(135deg,#E63946,#C0392B)"};
  if(!msg) return null;
  return <div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:bg[type]||bg.info,color:"#000",fontWeight:800,fontSize:14,padding:"9px 20px",borderRadius:20,boxShadow:"0 4px 20px rgba(0,0,0,0.5)",zIndex:9999,animation:"dn 0.3s ease",whiteSpace:"nowrap"}}>{msg}</div>;
}

const DICE_DOTS={1:[[50,50]],2:[[26,26],[74,74]],3:[[26,26],[50,50],[74,74]],4:[[26,26],[74,26],[26,74],[74,74]],5:[[26,26],[74,26],[50,50],[26,74],[74,74]],6:[[26,20],[74,20],[26,50],[74,50],[26,80],[74,80]]};
function Dice({val,rolling,onRoll,disabled,sz=68}){
  const dots=val?DICE_DOTS[val]:[];
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
      <button onClick={()=>!disabled&&!rolling&&onRoll()} disabled={disabled||rolling} style={{background:"none",border:"none",cursor:disabled||rolling?"not-allowed":"pointer",opacity:disabled?0.42:1,padding:0}} className="btnH">
        <div style={{width:sz,height:sz,background:rolling?"linear-gradient(135deg,#FF6B35,#FFD700)":"linear-gradient(145deg,#fffde7,#fff9c4)",borderRadius:sz*0.2,border:"3px solid #c8960c",boxShadow:rolling?"0 0 20px rgba(255,165,0,0.8)":"0 4px 14px rgba(200,150,12,0.5)",position:"relative",animation:rolling?"spin 0.15s linear infinite":"none",transition:"background 0.2s"}}>
          {dots.map(([x,y],i)=><div key={i} style={{position:"absolute",width:sz*0.14,height:sz*0.14,background:rolling?"#fff":"#1a0033",borderRadius:"50%",left:`${x}%`,top:`${y}%`,transform:"translate(-50%,-50%)"}}/>)}
          {!val&&!rolling&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:sz*0.44}}>🎲</div>}
        </div>
      </button>
      <div style={{color:disabled?T.t3:T.gold,fontSize:9,fontWeight:700}}>{rolling?"Rolling...":disabled?"Wait...":"PHENKO!"}</div>
    </div>
  );
}

function AvatarPicker({sel,onSel}){
  const [cat,setCat]=useState(Object.keys(AVATAR_CATS)[0]);
  return(
    <div style={{background:"rgba(0,0,0,0.3)",borderRadius:14,padding:12,border:"1px solid rgba(255,215,0,0.13)"}}>
      <div style={{textAlign:"center",marginBottom:10}}><div style={{fontSize:42}}>{sel}</div><div style={{color:T.t3,fontSize:9}}>Selected</div></div>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:8,justifyContent:"center"}}>
        {Object.keys(AVATAR_CATS).map(c=><button key={c} onClick={()=>setCat(c)} style={{padding:"2px 6px",background:cat===c?"rgba(255,215,0,0.18)":"transparent",border:`1px solid ${cat===c?"rgba(255,215,0,0.4)":"rgba(255,255,255,0.09)"}`,borderRadius:7,color:cat===c?T.gold:T.t3,fontSize:9,cursor:"pointer",fontFamily:"'Baloo 2',cursive"}}>{c}</button>)}
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center"}}>
        {AVATAR_CATS[cat].map(av=><button key={av} onClick={()=>onSel(av)} style={{fontSize:26,background:sel===av?"rgba(255,215,0,0.22)":"rgba(255,255,255,0.05)",border:`2px solid ${sel===av?"#FFD700":"transparent"}`,borderRadius:9,padding:"3px 6px",cursor:"pointer",transform:sel===av?"scale(1.18)":"scale(1)",transition:"all 0.15s"}}>{av}</button>)}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// YARD ZONE
// ══════════════════════════════════════════════
function YardZone({pid,pieces,movable,onClick,pData,active,reaction}){
  const p=PLAYERS[pid];
  return(
    <div style={{width:CELL_SIZE*6,height:CELL_SIZE*6,background:`linear-gradient(135deg,${p.color}15,${p.color}05)`,border:`3px solid ${active?p.color:p.color+"28"}`,borderRadius:14,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"space-between",padding:"7px 5px",boxShadow:active?`0 0 22px ${p.color}60`:"none",transition:"all 0.3s",position:"relative",overflow:"visible"}}>
      {reaction&&<div style={{position:"absolute",top:-36,left:"50%",transform:"translateX(-50%)",fontSize:28,zIndex:60,animation:"react 2.4s ease forwards",pointerEvents:"none"}}>{reaction}</div>}
      {active&&<div style={{position:"absolute",top:-10,left:"50%",transform:"translateX(-50%)",background:`linear-gradient(135deg,${p.color},${p.dark})`,color:"white",fontSize:8,fontWeight:900,padding:"2px 8px",borderRadius:8,whiteSpace:"nowrap",animation:"pulse 1s ease-in-out infinite",zIndex:10}}>▶ BAARI</div>}
      <div style={{textAlign:"center",width:"100%"}}>
        <div style={{fontSize:24}}>{pData?.avatar||"👤"}</div>
        <div style={{color:p.color,fontWeight:800,fontSize:10,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%",padding:"0 3px"}}>{pData?.name||p.name}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,flexGrow:1,alignContent:"center"}}>
        {pieces.map((pc,idx)=>{
          const mv=movable.some(m=>m.i===idx&&m.pid===pid);
          return(
            <div key={idx} style={{width:CELL_SIZE*1.05,height:CELL_SIZE*1.05,borderRadius:"50%",background:`${p.color}15`,border:`2px dashed ${p.color}38`,display:"flex",alignItems:"center",justifyContent:"center"}}>
              {pc.cell===-1&&(
                <div onClick={()=>mv&&onClick(pid,idx)} className={mv?"movable":""} style={{width:26,height:26,borderRadius:"50%",background:`radial-gradient(circle at 35% 30%,${p.light} 18%,${p.color} 58%,${p.dark} 100%)`,border:mv?"3px solid white":`2px solid ${p.dark}`,boxShadow:mv?"0 0 10px white":"0 2px 8px rgba(0,0,0,0.6)",cursor:mv?"pointer":"default",position:"relative",transition:"all 0.15s"}}>
                  <div style={{position:"absolute",width:"36%",height:"36%",borderRadius:"50%",background:"rgba(255,255,255,0.5)",top:"14%",left:"14%"}}/>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        <span style={{fontSize:10}}>⚔️</span>
        <span style={{color:p.color,fontWeight:900,fontSize:14}}>{pData?.kills||0}</span>
        <span style={{fontSize:9}}>🏅</span>
        <span style={{color:"rgba(255,215,0,0.55)",fontSize:10,fontWeight:700}}>{pData?.score||0}</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// GAME OVER
// ══════════════════════════════════════════════
function GameOver({winner,players,scores,kills,startTime,onAgain,onHome}){
  const p=PLAYERS[winner], pd=players?.[winner];
  const dur=((Date.now()-(startTime||Date.now()))/60000).toFixed(1);
  const ranked=[0,1,2,3].map(i=>({id:i,score:scores[i]||0,kills:kills[i]||0,name:players?.[i]?.name||PLAYERS[i].name,avatar:players?.[i]?.avatar||"👤"})).sort((a,b)=>b.score-a.score);
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:500,padding:18,overflowY:"auto"}}>
      <Confetti on={true}/>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:14,maxWidth:420,width:"100%",animation:"win 0.8s ease forwards"}}>
        <div style={{fontSize:64,filter:"drop-shadow(0 0 18px gold)",animation:"pulse 1s ease-in-out infinite"}}>🏆</div>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:38}}>{pd?.avatar||"👤"}</div>
          <div style={{...goldTxt,fontSize:34,margin:"4px 0 2px"}}>{pd?.name||p.name}</div>
          <div style={{color:p.color,fontSize:19,fontWeight:900}}>JEET GAYA! 🎊</div>
          <div style={{color:T.t3,fontSize:11,marginTop:3}}>{dur} mins ka game</div>
        </div>
        <div style={{width:"100%",...card}}>
          <div style={{color:T.gold,fontWeight:800,fontSize:13,marginBottom:8}}>📊 Final Standings</div>
          {ranked.map((rp,rank)=>{
            const pp=PLAYERS[rp.id];
            return(
              <div key={rp.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:9,marginBottom:4,background:rank===0?"rgba(255,215,0,0.12)":"rgba(255,255,255,0.03)",border:`1px solid ${rank===0?"rgba(255,215,0,0.35)":"rgba(255,255,255,0.05)"}`}}>
                <div style={{fontWeight:900,fontSize:16,color:["#FFD700","#C0C0C0","#CD7F32","rgba(255,255,255,0.3)"][rank],width:22,textAlign:"center"}}>{["🥇","🥈","🥉","4"][rank]}</div>
                <div style={{fontSize:18}}>{rp.avatar}</div>
                <div style={{flex:1}}><div style={{color:pp.color,fontWeight:700,fontSize:12}}>{rp.name}</div><div style={{color:T.t3,fontSize:9}}>⚔️{rp.kills} kills</div></div>
                <div style={{color:T.gold,fontWeight:900,fontSize:14}}>{rp.score}pts</div>
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",gap:10,width:"100%"}}>
          <button onClick={onAgain} style={{...btnA,flex:1}} className="btnH">🔄 Phir Khelo</button>
          <button onClick={onHome} style={{...btnB,flex:1}} className="btnH">🏠 Home</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// HOME SCREEN
// ══════════════════════════════════════════════
function Home({profile,onNav}){
  const tips=["💡 6 aane par goti enter karo!","⭐ Safe cells pe safe rehte ho!","🔥 Kill = 10 bonus points!","🏠 Room code se online khelo!","🤖 Bot mode ON karo!"];
  const [tip,setTip]=useState(0);
  useEffect(()=>{ const iv=setInterval(()=>setTip(t=>(t+1)%tips.length),4000); return()=>clearInterval(iv); },[]);
  const page={minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Baloo 2',cursive",padding:"20px 14px",gap:18,position:"relative",overflowX:"hidden"};
  return(
    <div style={page}>
      <style>{CSS}</style><Particles/>
      <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:17,width:"100%",maxWidth:400}}>
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:66,animation:"float 3s ease-in-out infinite",filter:"drop-shadow(0 0 16px rgba(255,215,0,0.5))"}}>🎲</div>
          <h1 style={{...goldTxt,fontSize:50,margin:"4px 0 2px",letterSpacing:2}}>LUDO ALA</h1>
          <div style={{background:"linear-gradient(90deg,#FF6B35,#FFD700)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",fontWeight:800,fontSize:11,letterSpacing:3}}>BATTLE MODE • v4.0</div>
        </div>
        {profile&&(
          <div onClick={()=>onNav("profile")} style={{display:"flex",alignItems:"center",gap:9,padding:"7px 14px",background:"rgba(255,215,0,0.07)",border:"1.5px solid rgba(255,215,0,0.2)",borderRadius:26,cursor:"pointer"}} className="btnH">
            <div style={{fontSize:22}}>{profile.avatar}</div>
            <div><div style={{color:"white",fontWeight:700,fontSize:12}}>{profile.name}</div><div style={{color:"rgba(255,215,0,0.5)",fontSize:9}}>🏆{profile.gamesWon||0} wins • Edit profile</div></div>
          </div>
        )}
        <div style={{width:"100%",display:"flex",flexDirection:"column",gap:9}}>
          <button onClick={()=>onNav("setup")} style={{...btnA,width:"100%",fontSize:17,padding:"13px",display:"flex",flexDirection:"column",alignItems:"center"}} className="btnH">
            <span>🏠 Offline Khelo</span>
            <span style={{fontSize:10,fontWeight:600,opacity:0.7}}>Same device — 2 to 4 players</span>
          </button>
          <button onClick={()=>onNav("login")} style={{...btnB,width:"100%",fontSize:17,padding:"13px",display:"flex",flexDirection:"column",alignItems:"center"}} className="btnH">
            <span>🌐 Online Khelo</span>
            <span style={{fontSize:10,fontWeight:600,opacity:0.7}}>Supabase Realtime — Dosto ke saath</span>
          </button>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>onNav("lb")} style={{...btnC,flex:1}} className="btnH">🏆 Leaderboard</button>
            <button onClick={()=>onNav("rules")} style={{...btnC,flex:1}} className="btnH">📖 Rules</button>
          </div>
        </div>
        <div style={{width:"100%",padding:"7px 12px",background:"rgba(255,215,0,0.05)",borderRadius:10,border:"1px solid rgba(255,215,0,0.12)"}}>
          <div style={{color:T.gold,fontSize:12,animation:"pop 0.5s ease"}}>{tips[tip]}</div>
        </div>
        <div style={{color:"rgba(255,255,255,0.1)",fontSize:9}}>Made with ❤️ for Desi Players</div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// SETUP SCREEN
// ══════════════════════════════════════════════
function Setup({profile,onStart,onBack}){
  const [n,setN]=useState(4);
  const [names,setNames]=useState(PLAYERS.map((p,i)=>i===0?(profile?.name||"Player 1"):p.name));
  const [avs,setAvs]=useState(PLAYERS.map((_,i)=>i===0?(profile?.avatar||"👸"):ALL_AVS[i*3]));
  const [bots,setBots]=useState([false,true,true,true]);
  const [editing,setEditing]=useState(null);
  const page={minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",fontFamily:"'Baloo 2',cursive",padding:"18px 14px",gap:12,position:"relative",overflowX:"hidden"};
  return(
    <div style={page}>
      <style>{CSS}</style><Particles/>
      <div style={{display:"flex",alignItems:"center",gap:10,width:"100%",maxWidth:440,zIndex:1}}>
        <button onClick={onBack} style={{...btnC,padding:"6px 11px"}}>←</button>
        <h2 style={{...goldTxt,fontSize:22}}>⚙️ Game Setup</h2>
      </div>
      <div style={{width:"100%",maxWidth:440,display:"flex",flexDirection:"column",gap:12,zIndex:1}}>
        <div style={card}>
          <label style={{color:T.gold,fontWeight:700,fontSize:13,display:"block",marginBottom:7}}>👥 Kitne Khiladi?</label>
          <div style={{display:"flex",gap:8}}>
            {[2,3,4].map(x=><button key={x} onClick={()=>setN(x)} style={{flex:1,padding:"11px 0",background:n===x?"linear-gradient(135deg,#FFD700,#FF6B35)":"rgba(255,255,255,0.06)",border:`2px solid ${n===x?"#FFD700":"rgba(255,255,255,0.1)"}`,borderRadius:12,color:n===x?"#000":T.t2,fontWeight:900,fontSize:18,cursor:"pointer",fontFamily:"'Baloo 2',cursive"}}>{x}</button>)}
          </div>
        </div>
        {PLAYERS.slice(0,n).map((p,i)=>(
          <div key={i} style={{...card,border:`1.5px solid ${p.color}3A`}}>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <div onClick={()=>setEditing(editing===i?null:i)} style={{width:52,height:52,borderRadius:"50%",background:`${p.color}1A`,border:`2px solid ${p.color}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:27,cursor:"pointer",flexShrink:0,transition:"transform 0.15s",transform:editing===i?"scale(1.1)":"scale(1)"}}>{avs[i]}</div>
              <div style={{flex:1}}>
                <div style={{display:"flex",gap:6,marginBottom:4,alignItems:"center"}}>
                  <span style={{display:"inline-flex",alignItems:"center",padding:"2px 8px",background:`${p.color}20`,border:`1px solid ${p.color}50`,borderRadius:18,color:p.color,fontSize:9,fontWeight:700}}>{p.name}</span>
                  <span style={{color:T.t3,fontSize:9}}>Slot {i+1}</span>
                </div>
                <input value={names[i]} onChange={e=>{const na=[...names];na[i]=e.target.value.slice(0,16);setNames(na);}} placeholder={`Player ${i+1} ka naam...`} style={{...inp,padding:"7px 10px",fontSize:13}}/>
              </div>
              {i>0&&(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                  <div style={{color:T.t3,fontSize:8}}>BOT</div>
                  <button onClick={()=>{const nb=[...bots];nb[i]=!nb[i];setBots(nb);}} style={{width:36,height:20,borderRadius:10,background:bots[i]?"linear-gradient(135deg,#4361EE,#2DC653)":"rgba(255,255,255,0.08)",border:"none",cursor:"pointer",position:"relative",transition:"background 0.2s"}}>
                    <div style={{width:14,height:14,borderRadius:"50%",background:"white",position:"absolute",top:3,left:bots[i]?19:3,transition:"left 0.2s"}}/>
                  </button>
                  <div style={{color:bots[i]?"#4361EE":T.t3,fontSize:8}}>{bots[i]?"🤖":"👤"}</div>
                </div>
              )}
            </div>
            {editing===i&&<div style={{marginTop:10}}><AvatarPicker sel={avs[i]} onSel={av=>{const na=[...avs];na[i]=av;setAvs(na);}}/></div>}
          </div>
        ))}
        <button onClick={()=>onStart({n,players:PLAYERS.slice(0,n).map((p,i)=>({id:i,name:names[i]||p.name,avatar:avs[i],isBot:i>0&&bots[i],kills:0,score:0}))})} style={{...btnA,width:"100%",fontSize:17,padding:"13px"}} className="btnH">🎮 Khel Shuru Karo! 🎲</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// LOGIN SCREEN (now uses Supabase, no firebase needed)
// ══════════════════════════════════════════════
function Login({profile,onLogin,onBack,onToast}){
  const [name,setName]=useState(profile?.name||"");
  const [av,setAv]=useState(profile?.avatar||"👸");
  const [loading,setLoading]=useState(false);

  const page={minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"'Baloo 2',cursive",padding:"20px 14px",gap:16,position:"relative",overflowX:"hidden"};

  const doLogin=async()=>{
    if(!name.trim()){ onToast("Naam toh likho! ✍️","error"); return; }
    setLoading(true);
    try{
      const ok=await initSB();
      if(!ok) throw new Error("Supabase init failed");
      // Use saved uid or generate new one
      const uid=(profile?.uid)||("u_"+Math.random().toString(36).slice(2,10));
      const p={...(profile||defProfile()),name:name.trim(),avatar:av,uid};
      saveProfile(p);
      onToast("Login ho gaya! 🎉","success");
      onLogin(p);
    }catch(e){
      onToast("Connection error! Internet check karo 🌐","error");
    }
    setLoading(false);
  };

  return(
    <div style={page}>
      <style>{CSS}</style><Particles/>
      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:410,display:"flex",flexDirection:"column",gap:14}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={onBack} style={{...btnC,padding:"6px 11px"}}>←</button>
          <h2 style={{...goldTxt,fontSize:22}}>🔑 Online Login</h2>
        </div>
        <div style={card}>
          <label style={{color:T.gold,fontWeight:700,fontSize:13,display:"block",marginBottom:6}}>✏️ Apna Naam</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Naam likho..." maxLength={20} style={inp} onKeyDown={e=>e.key==="Enter"&&doLogin()}/>
        </div>
        <div style={card}>
          <label style={{color:T.gold,fontWeight:700,fontSize:13,display:"block",marginBottom:9}}>🎭 Avatar</label>
          <AvatarPicker sel={av} onSel={setAv}/>
        </div>
        <div style={{padding:"11px 13px",background:"rgba(44,198,83,0.07)",borderRadius:12,border:"1px solid rgba(44,198,83,0.22)"}}>
          <div style={{color:"#2DC653",fontWeight:800,fontSize:12,marginBottom:5}}>✅ Supabase Connected!</div>
          <div style={{color:T.t2,fontSize:10,lineHeight:1.7}}>No extra setup needed. Bas naam likho aur khelo!<br/>Realtime sync automatically kaam karega. 🚀</div>
        </div>
        <button onClick={doLogin} disabled={loading} style={{...btnA,width:"100%",fontSize:16,opacity:loading?0.7:1}} className="btnH">{loading?"⏳ Connecting...":"🚀 Login & Continue"}</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// ONLINE LOBBY SCREEN
// ══════════════════════════════════════════════
function Lobby({profile,onGameStart,onBack,onToast}){
  const [tab,setTab]=useState("create");
  const [code,setCode]=useState("");
  const [joinCode,setJoinCode]=useState("");
  const [roomData,setRoomData]=useState(null);
  const [mySlot,setMySlot]=useState(null);
  const [loading,setLoading]=useState(false);
  const [copying,setCopying]=useState(false);
  const unsubRef=useRef(null);
  const mySlotRef=useRef(null);

  useEffect(()=>()=>{ if(unsubRef.current) unsubRef.current(); },[]);

  const subRoom=(c)=>{
    if(unsubRef.current) unsubRef.current();
    unsubRef.current=sbSubscribe(c, data=>{
      // Parse JSON fields from DB
      const parsed = {
        ...data,
        players: typeof data.players === "string" ? JSON.parse(data.players) : (data.players||{}),
        pieces: typeof data.pieces === "string" ? JSON.parse(data.pieces) : data.pieces,
        kills: typeof data.kills === "string" ? JSON.parse(data.kills) : data.kills,
        scores: typeof data.scores === "string" ? JSON.parse(data.scores) : data.scores,
        log: typeof data.log === "string" ? JSON.parse(data.log) : data.log,
      };
      setRoomData(parsed);
      if(parsed.status==="playing") onGameStart(parsed, mySlotRef.current!==null?mySlotRef.current:0);
    });
  };

  const createRoom=async()=>{
    setLoading(true);
    try{
      const rc=Array.from({length:6},()=>CODE_CHARS[Math.floor(Math.random()*CODE_CHARS.length)]).join("");
      const players={0:{uid:profile.uid,name:profile.name,avatar:profile.avatar,kills:0,score:0}};
      const rData={
        code:rc, host:profile.uid, status:"waiting", created_at:new Date().toISOString(),
        players:JSON.stringify(players)
      };
      await sbSet(rc,rData);
      setCode(rc); setMySlot(0); mySlotRef.current=0;
      setRoomData({...rData, players});
      subRoom(rc);
      onToast(`Room banaya! Code: ${rc} 🏠`,"success");
    }catch(e){
      console.error(e);
      onToast("Room banana failed! Internet check karo 🌐","error");
    }
    setLoading(false);
  };

  const joinRoom=async()=>{
    const jc=joinCode.trim().toUpperCase();
    if(jc.length!==6){ onToast("6 character ka code likho!","error"); return; }
    setLoading(true);
    try{
      const raw=await sbGet(jc);
      if(!raw){ onToast("Room nahi mila! ❌","error"); setLoading(false); return; }
      const rData={
        ...raw,
        players: typeof raw.players==="string"?JSON.parse(raw.players):(raw.players||{}),
      };
      if(rData.status==="playing"){ onToast("Game already shuru ho gaya!","error"); setLoading(false); return; }
      const used=Object.keys(rData.players||{}).map(Number);
      const free=[0,1,2,3].find(s=>!used.includes(s));
      if(free===undefined){ onToast("Room full hai! 😅","error"); setLoading(false); return; }
      const updPlayers={...rData.players,[free]:{uid:profile.uid,name:profile.name,avatar:profile.avatar,kills:0,score:0}};
      await sbUpdate(jc,{players:JSON.stringify(updPlayers)});
      setMySlot(free); mySlotRef.current=free; setCode(jc);
      setRoomData({...rData,players:updPlayers});
      subRoom(jc);
      onToast(`Room join kiya! Slot ${free+1} 🎮`,"success");
    }catch(e){
      console.error(e);
      onToast("Join error! Room code check karo","error");
    }
    setLoading(false);
  };

  const startGame=async()=>{
    const n=Object.keys(roomData.players||{}).length;
    const gs=mkGS(n);
    await sbUpdate(code,{
      status:"playing", current_player:0, dice_val:null, dice_rolled:false,
      winner:null, pieces:JSON.stringify(gs.pieces), kills:JSON.stringify(gs.kills),
      scores:JSON.stringify(gs.scores), log:JSON.stringify(["🎉 Game shuru! Red pehle!"]),
      turns:0, start_time:Date.now()
    });
  };

  const copyCode=()=>{ navigator.clipboard.writeText(code).then(()=>{ setCopying(true); setTimeout(()=>setCopying(false),1500); onToast("Code copy ho gaya! 📋","success"); }); };
  const share=()=>{ if(navigator.share) navigator.share({title:"Ludo Ala",text:`Mere saath Ludo Ala khelo! Room code: ${code}`,url:window.location.href}); else copyCode(); };

  const players=roomData?.players||{};
  const count=Object.keys(players).length;
  const isHost=roomData?.host===profile?.uid;
  const page={minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",fontFamily:"'Baloo 2',cursive",padding:"18px 14px",gap:13,position:"relative",overflowX:"hidden"};

  return(
    <div style={page}>
      <style>{CSS}</style><Particles/>
      <div style={{display:"flex",alignItems:"center",gap:10,width:"100%",maxWidth:450,zIndex:1}}>
        <button onClick={onBack} style={{...btnC,padding:"6px 11px"}}>←</button>
        <h2 style={{...goldTxt,fontSize:22}}>🌐 Online Lobby</h2>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
          <div style={{fontSize:20}}>{profile?.avatar}</div>
          <div style={{color:"rgba(255,215,0,0.6)",fontSize:11}}>{profile?.name}</div>
        </div>
      </div>
      <div style={{width:"100%",maxWidth:450,display:"flex",flexDirection:"column",gap:12,zIndex:1}}>
        {!code&&(
          <div style={{display:"flex",gap:8}}>
            {["create","join"].map(t=><button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"12px 0",background:tab===t?"linear-gradient(135deg,#FFD700,#FF6B35)":"rgba(255,255,255,0.06)",border:"none",borderRadius:12,color:tab===t?"#000":T.t2,fontWeight:800,fontSize:15,cursor:"pointer",fontFamily:"'Baloo 2',cursive"}}>{t==="create"?"🏠 Room Banao":"🔑 Room Join Karo"}</button>)}
          </div>
        )}
        {!code&&tab==="create"&&(
          <div style={card}>
            <div style={{color:T.t2,fontSize:12,marginBottom:13,lineHeight:1.6}}>Ek unique 6-character room code banao. Dosto ko bhejo — woh "Room Join Karo" se enter karenge!</div>
            <button onClick={createRoom} disabled={loading} style={{...btnA,width:"100%",opacity:loading?0.7:1}} className="btnH">{loading?"⏳ Bana raha...":"🏠 Naya Room Banao"}</button>
          </div>
        )}
        {!code&&tab==="join"&&(
          <div style={card}>
            <label style={{color:T.gold,fontWeight:700,fontSize:13,display:"block",marginBottom:7}}>🔑 Room Code Enter Karo</label>
            <div style={{display:"flex",gap:8}}>
              <input value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase().slice(0,6))} placeholder="ABC123" style={{...inp,flex:1,textAlign:"center",letterSpacing:5,fontWeight:900,fontSize:22}} onKeyDown={e=>e.key==="Enter"&&joinRoom()}/>
              <button onClick={joinRoom} disabled={loading} style={{...btnA,padding:"10px 15px"}}>{loading?"⏳":"Join"}</button>
            </div>
            <div style={{color:T.t3,fontSize:10,marginTop:7}}>Dost se room code maango aur yahan enter karo</div>
          </div>
        )}
        {code&&(
          <div style={{...card,textAlign:"center",background:"linear-gradient(135deg,rgba(255,215,0,0.08),rgba(255,107,53,0.07))",border:"2px solid rgba(255,215,0,0.32)"}}>
            <div style={{color:"rgba(255,215,0,0.55)",fontSize:11,marginBottom:5}}>ROOM CODE — Dosto ko bhejo! 📤</div>
            <div style={{...goldTxt,fontSize:42,letterSpacing:8,lineHeight:1}}>{code}</div>
            <div style={{color:T.t3,fontSize:10,margin:"7px 0"}}>Yeh code share karo — dost "Room Join Karo" se enter karenge</div>
            <div style={{display:"flex",gap:8,justifyContent:"center"}}>
              <button onClick={copyCode} style={{...btnB,padding:"8px 14px",fontSize:13}} className="btnH">{copying?"✅ Copied!":"📋 Copy"}</button>
              <button onClick={share} style={{...btnA,padding:"8px 14px",fontSize:13}} className="btnH">📤 Share</button>
            </div>
          </div>
        )}
        {code&&(
          <div style={card}>
            <div style={{color:T.gold,fontWeight:800,fontSize:13,marginBottom:9}}>👥 Players ({count}/4) <span style={{color:"#2DC653",fontSize:10}}>🟢 Live</span></div>
            {[0,1,2,3].map(slot=>{
              const pd=players[slot], pp=PLAYERS[slot], empty=!pd;
              return(
                <div key={slot} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:11,marginBottom:6,background:empty?"rgba(255,255,255,0.03)":`${pp.color}15`,border:`1.5px solid ${empty?"rgba(255,255,255,0.07)":pp.color+"45"}`,transition:"all 0.3s",animation:!empty?"up 0.4s ease":"none"}}>
                  <div style={{width:40,height:40,borderRadius:"50%",background:empty?"rgba(255,255,255,0.06)":`${pp.color}1A`,border:`2px solid ${empty?"rgba(255,255,255,0.09)":pp.color+"55"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{empty?"❓":(pd.avatar||"👤")}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{color:empty?T.t3:pp.color,fontWeight:800,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{empty?`Slot ${slot+1} — Waiting...`:pd.name}{pd?.uid===profile?.uid?" 👈 You":""}</div>
                    <div style={{color:T.t3,fontSize:10}}>Slot {slot+1} • {pp.name} {pd?.uid===roomData?.host?"👑 Host":""}</div>
                  </div>
                  {!empty&&<div style={{display:"flex",gap:3,alignItems:"center"}}><div style={{width:7,height:7,borderRadius:"50%",background:"#2DC653"}}/><span style={{color:"rgba(44,198,83,0.6)",fontSize:8}}>Online</span></div>}
                  {empty&&<div style={{color:"rgba(255,255,255,0.18)",fontSize:10,animation:"pulse 1.5s ease-in-out infinite"}}>⏳</div>}
                </div>
              );
            })}
          </div>
        )}
        {code&&isHost&&<button onClick={startGame} disabled={count<2} style={{...btnA,width:"100%",fontSize:17,padding:"13px",opacity:count<2?0.5:1,cursor:count<2?"not-allowed":"pointer"}} className="btnH">{count<2?`⏳ Aur players ka intezaar... (${count}/2)`:`🎮 Game Shuru Karo! (${count} players)`}</button>}
        {code&&!isHost&&<div style={{...card,textAlign:"center",background:"rgba(67,97,238,0.1)",border:"1.5px solid rgba(67,97,238,0.28)"}}>
          <div style={{animation:"pulse 1.5s ease-in-out infinite",fontSize:14}}>⏳ Host game shuru karne ka intezaar...</div>
          <div style={{color:T.t3,fontSize:10,marginTop:4}}>Jab host "Game Shuru Karo" dabayega, automatic start hoga</div>
        </div>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// LEADERBOARD SCREEN
// ══════════════════════════════════════════════
function LBScreen({onBack,uid}){
  const [entries,setEntries]=useState([]);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    setEntries(getLB());
    setLoading(false);
  },[]);
  const rc=["#FFD700","#C0C0C0","#CD7F32"];
  const re=["🥇","🥈","🥉"];
  const page={minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",fontFamily:"'Baloo 2',cursive",padding:"18px 14px",gap:12,position:"relative",overflowX:"hidden"};
  return(
    <div style={page}>
      <style>{CSS}</style><Particles/>
      <div style={{display:"flex",alignItems:"center",gap:10,width:"100%",maxWidth:430,zIndex:1}}>
        <button onClick={onBack} style={{...btnC,padding:"6px 11px"}}>←</button>
        <h2 style={{...goldTxt,fontSize:22}}>🏆 Leaderboard</h2>
      </div>
      <div style={{width:"100%",maxWidth:430,zIndex:1}}>
        {loading?<div style={{textAlign:"center",padding:36}}><div style={{fontSize:28,animation:"spin 1s linear infinite"}}>⏳</div></div>
        :entries.length===0?<div style={{...card,textAlign:"center",padding:26}}><div style={{fontSize:34}}>📭</div><div style={{color:T.t3,marginTop:7}}>Koi data nahi. Pehle khelo! 🎲</div></div>
        :entries.map((e,i)=>(
          <div key={e.uid||i} style={{display:"flex",alignItems:"center",gap:9,padding:"9px 12px",borderRadius:11,marginBottom:6,background:e.uid===uid?"rgba(255,215,0,0.1)":i<3?`${rc[i]}13`:"rgba(255,255,255,0.03)",border:`1.5px solid ${e.uid===uid?"rgba(255,215,0,0.4)":i<3?rc[i]+"40":"rgba(255,255,255,0.05)"}`,animation:"pop 0.3s"}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:`${(rc[i]||"rgba(255,255,255,0.18)")}20`,border:`2px solid ${(rc[i]||"rgba(255,255,255,0.18)")}50`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:i<3?16:12,color:rc[i]||T.t3,flexShrink:0}}>{i<3?re[i]:i+1}</div>
            <div style={{fontSize:20,flexShrink:0}}>{e.avatar||"👤"}</div>
            <div style={{flex:1,minWidth:0}}><div style={{color:e.uid===uid?T.gold:"white",fontWeight:700,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.name}{e.uid===uid?" (You)":""}</div><div style={{color:T.t3,fontSize:10}}>{e.wins||0} wins</div></div>
            <div style={{color:rc[i]||T.t3,fontWeight:900,fontSize:15,flexShrink:0}}>{e.totalScore||e.score||0}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// PROFILE SCREEN
// ══════════════════════════════════════════════
function ProfileScreen({profile,onUpdate,onBack}){
  const [name,setName]=useState(profile.name);
  const [av,setAv]=useState(profile.avatar);
  const page={minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",fontFamily:"'Baloo 2',cursive",padding:"18px 14px",gap:12,position:"relative",overflowX:"hidden"};
  return(
    <div style={page}>
      <style>{CSS}</style><Particles/>
      <div style={{display:"flex",alignItems:"center",gap:10,width:"100%",maxWidth:430,zIndex:1}}>
        <button onClick={onBack} style={{...btnC,padding:"6px 11px"}}>←</button>
        <h2 style={{...goldTxt,fontSize:22}}>👤 Profile</h2>
      </div>
      <div style={{width:"100%",maxWidth:430,display:"flex",flexDirection:"column",gap:12,zIndex:1}}>
        <div style={card}><label style={{color:T.gold,fontWeight:700,fontSize:13,display:"block",marginBottom:6}}>✏️ Naam</label><input value={name} onChange={e=>setName(e.target.value)} maxLength={20} style={inp}/></div>
        <div style={card}><label style={{color:T.gold,fontWeight:700,fontSize:13,display:"block",marginBottom:9}}>🎭 Avatar</label><AvatarPicker sel={av} onSel={setAv}/></div>
        <div style={card}>
          <div style={{color:T.gold,fontWeight:800,fontSize:13,marginBottom:9}}>📊 Stats</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {[{t:"Games",v:profile.gamesPlayed||0,ic:"🎲",c:"#4361EE"},{t:"Wins",v:profile.gamesWon||0,ic:"🏆",c:"#FFD700"},{t:"Kills",v:profile.totalKills||0,ic:"⚔️",c:"#E63946"},{t:"Score",v:profile.totalScore||0,ic:"🏅",c:"#2DC653"}].map(s=>(
              <div key={s.t} style={{flex:1,minWidth:68,padding:"10px 7px",background:`${s.c}12`,border:`1px solid ${s.c}30`,borderRadius:13,textAlign:"center"}}><div style={{fontSize:18}}>{s.ic}</div><div style={{color:s.c,fontWeight:900,fontSize:18,lineHeight:1}}>{s.v}</div><div style={{color:T.t3,fontSize:9,marginTop:2}}>{s.t}</div></div>
            ))}
          </div>
        </div>
        <button onClick={()=>{const p={...profile,name:name.trim()||"Player",avatar:av};saveProfile(p);onUpdate(p);onBack();}} style={{...btnA,width:"100%"}} className="btnH">💾 Save Profile</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// RULES SCREEN
// ══════════════════════════════════════════════
function Rules({onBack}){
  const rules=[{ic:"🎲",t:"Dice Phenko",d:"Apni baari pe dice phenko. 6 aane par goti enter hoti hai."},{ic:"👆",t:"Goti Chuno",d:"Glowing goti click karo to move karo."},{ic:"⭐",t:"Safe Zone",d:"Star cells pe opponent nahi maar sakta!"},{ic:"⚔️",t:"Kill!",d:"Opponent ki goti pe chadh jao — woh wapas yard!"},{ic:"🏠",t:"Ghar Wapas",d:"Sabhi 4 goti ghar bhejo = Win!"},{ic:"🎁",t:"6 = Bonus",d:"6 aane par extra turn milta hai!"},{ic:"🏆",t:"Win!",d:"Pehle sabhi 4 goti ghar = WINNER! 🎊"}];
  const page={minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",fontFamily:"'Baloo 2',cursive",padding:"18px 14px",gap:11,position:"relative",overflowX:"hidden"};
  return(
    <div style={page}>
      <style>{CSS}</style><Particles/>
      <div style={{display:"flex",alignItems:"center",gap:10,width:"100%",maxWidth:440,zIndex:1}}>
        <button onClick={onBack} style={{...btnC,padding:"6px 11px"}}>←</button>
        <h2 style={{...goldTxt,fontSize:22}}>📖 Kaise Khelein?</h2>
      </div>
      <div style={{width:"100%",maxWidth:440,display:"flex",flexDirection:"column",gap:9,zIndex:1}}>
        {rules.map((r,i)=>(
          <div key={i} style={{display:"flex",gap:12,padding:"12px 14px",background:"rgba(255,255,255,0.04)",borderRadius:13,border:"1px solid rgba(255,215,0,0.1)",animation:`up ${0.15+i*0.05}s ease`}}>
            <div style={{width:42,height:42,borderRadius:"50%",background:"rgba(255,215,0,0.1)",border:"2px solid rgba(255,215,0,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:21,flexShrink:0}}>{r.ic}</div>
            <div><div style={{color:T.gold,fontWeight:800,fontSize:14,marginBottom:2}}>{r.t}</div><div style={{color:T.t2,fontSize:11,lineHeight:1.5}}>{r.d}</div></div>
          </div>
        ))}
        <button onClick={onBack} style={{...btnA,width:"100%"}} className="btnH">🎲 Game Shuru Karo!</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════
// MAIN GAME BOARD
// ══════════════════════════════════════════════
function Board({gs,players,mySlot,isOnline,roomCode,onMove,onRoll,onReact,reactions,onHome,onReset}){
  const {pieces,cur,dice,rolled,winner,n,log,kills,scores,turns,start}=gs;
  const movable=rolled&&!winner?getMovable(gs,cur,dice):[];
  const p=PLAYERS[cur];
  const gridPx=BOARD_SIZE*CELL_SIZE;
  const isMyTurn=!isOnline||mySlot===cur;

  const boardCells=[];
  for(let r=0;r<BOARD_SIZE;r++){
    for(let c=0;c<BOARD_SIZE;c++){
      if((r<6&&c<6)||(r<6&&c>8)||(r>8&&c<6)||(r>8&&c>8)) continue;
      const safe=SAFE.some(sc=>{ const pos=cellToPos(sc); return pos&&pos[0]===r&&pos[1]===c; });
      const center=r>=6&&r<=8&&c>=6&&c<=8;
      let hl=null;
      if(r===7&&c>=1&&c<=5) hl=PLAYERS[0].color;
      if(r>=1&&r<=5&&c===7) hl=PLAYERS[1].color;
      if(r===7&&c>=9&&c<=13) hl=PLAYERS[2].color;
      if(r>=9&&r<=13&&c===7) hl=PLAYERS[3].color;
      boardCells.push(
        <div key={`${r}-${c}`} style={{position:"absolute",left:c*CELL_SIZE,top:r*CELL_SIZE,width:CELL_SIZE,height:CELL_SIZE,background:center?"linear-gradient(135deg,#FFD700,#FF6B35,#E63946)":hl?`${hl}3A`:safe?"#1a1a2e":(r+c)%2===0?"#16213e":"#0f3460",border:"1px solid rgba(100,100,200,0.13)",display:"flex",alignItems:"center",justifyContent:"center"}}>
          {safe&&!center&&<span style={{opacity:0.45,fontSize:12}}>⭐</span>}
          {center&&r===7&&c===7&&<span style={{fontSize:17}}>👑</span>}
        </div>
      );
    }
  }

  const boardPieces=pieces.flatMap((pp,pid)=>pp.map((pc,i)=>({...pc,pid,i})).filter(pc=>pc.cell>0&&pc.cell<=72));
  const cellGroups={};
  boardPieces.forEach(pc=>{ const k=pc.cell; if(!cellGroups[k]) cellGroups[k]=[]; cellGroups[k].push(pc); });

  const page={minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column",alignItems:"center",fontFamily:"'Baloo 2',cursive",padding:"10px 6px",overflowX:"hidden"};

  return(
    <div style={page}>
      <style>{CSS}</style><Particles/>
      {winner!==null&&<GameOver winner={winner} players={players} scores={scores} kills={kills} startTime={start} onAgain={onReset} onHome={onHome}/>}
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,width:"100%",maxWidth:580,zIndex:1}}>
        <button onClick={onHome} style={{...btnC,padding:"5px 9px",fontSize:15}}>🏠</button>
        <div style={{...goldTxt,fontSize:20,flex:1,textAlign:"center"}}>🎲 LUDO ALA</div>
        {isOnline&&roomCode&&<div style={{display:"inline-flex",alignItems:"center",padding:"2px 8px",background:"rgba(255,215,0,0.13)",border:"1px solid rgba(255,215,0,0.35)",borderRadius:18,color:T.gold,fontSize:9,fontWeight:700,letterSpacing:1}}>📡 {roomCode}</div>}
        <button onClick={onReset} style={{...btnC,padding:"5px 9px",fontSize:12}}>🔄</button>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"center",marginBottom:8,zIndex:1}}>
        {Array.from({length:n},(_,i)=>{
          const pp=PLAYERS[i], ac=cur===i;
          return <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"5px 9px",borderRadius:10,background:ac?`${pp.color}20`:"rgba(255,255,255,0.04)",border:`2px solid ${ac?pp.color:pp.color+"28"}`,boxShadow:ac?`0 0 11px ${pp.color}50`:"none",transition:"all 0.3s",minWidth:56}}><div style={{fontSize:13}}>{pp.emoji}</div><div style={{color:pp.color,fontWeight:900,fontSize:11}}>{scores[i]||0}pts</div><div style={{color:T.t3,fontSize:9}}>⚔️{kills[i]||0}</div></div>;
        })}
      </div>
      <div style={{display:"grid",gridTemplateColumns:`${CELL_SIZE*6}px ${gridPx}px ${CELL_SIZE*6}px`,gridTemplateRows:`${CELL_SIZE*6}px auto ${CELL_SIZE*6}px`,gap:3,zIndex:1}}>
        <div style={{gridColumn:1,gridRow:1}}><YardZone pid={0} pieces={pieces[0]} movable={cur===0?movable:[]} onClick={onMove} pData={players?.[0]} active={cur===0} reaction={reactions?.[0]}/></div>
        <div style={{gridColumn:3,gridRow:1}}><YardZone pid={1} pieces={pieces[1]} movable={cur===1?movable:[]} onClick={onMove} pData={players?.[1]} active={cur===1} reaction={reactions?.[1]}/></div>
        <div style={{gridColumn:2,gridRow:"1/4",position:"relative",width:gridPx,height:gridPx,borderRadius:11,overflow:"hidden",border:"3px solid rgba(255,215,0,0.55)",boxShadow:"0 0 44px rgba(80,50,200,0.55)"}}>
          {[[0,0,0],[0,9,1],[9,0,2],[9,9,3]].map(([r,c,pi])=>(
            <div key={pi} style={{position:"absolute",left:c*CELL_SIZE,top:r*CELL_SIZE,width:CELL_SIZE*6,height:CELL_SIZE*6,background:`linear-gradient(135deg,${PLAYERS[pi].color}18,${PLAYERS[pi].color}06)`,border:`2px solid ${PLAYERS[pi].color}1A`}}/>
          ))}
          {boardCells}
          {Object.entries(cellGroups).flatMap(([cell,cps])=>{
            const pos=cellToPos(Number(cell));
            if(!pos) return [];
            const [r,c]=pos;
            const offs=[[0,0],[7,0],[0,7],[7,7]];
            return cps.map((pc,si)=>{
              const mv=movable.some(m=>m.pid===pc.pid&&m.i===pc.i);
              const [ox,oy]=offs[si]||[3,3];
              const pp=PLAYERS[pc.pid];
              return(
                <div key={`${pc.pid}-${pc.i}`} onClick={()=>mv&&onMove(pc.pid,pc.i)} className={mv?"movable":""} style={{position:"absolute",left:c*CELL_SIZE+ox+(CELL_SIZE-(cps.length>1?17:22))/2,top:r*CELL_SIZE+oy+(CELL_SIZE-(cps.length>1?17:22))/2,width:cps.length>1?17:22,height:cps.length>1?17:22,borderRadius:"50%",background:`radial-gradient(circle at 35% 30%,${pp.light} 18%,${pp.color} 58%,${pp.dark} 100%)`,border:mv?"3px solid white":`2px solid ${pp.dark}`,boxShadow:mv?"0 0 12px white":"0 2px 8px rgba(0,0,0,0.6)",cursor:mv?"pointer":"default",zIndex:mv?40:12,transition:"all 0.15s"}}>
                  <div style={{position:"absolute",width:"36%",height:"36%",borderRadius:"50%",background:"rgba(255,255,255,0.5)",top:"14%",left:"14%"}}/>
                </div>
              );
            });
          })}
        </div>
        <div style={{gridColumn:1,gridRow:3}}><YardZone pid={2} pieces={pieces[2]} movable={cur===2?movable:[]} onClick={onMove} pData={players?.[2]} active={cur===2} reaction={reactions?.[2]}/></div>
        <div style={{gridColumn:3,gridRow:3}}><YardZone pid={3} pieces={pieces[3]} movable={cur===3?movable:[]} onClick={onMove} pData={players?.[3]} active={cur===3} reaction={reactions?.[3]}/></div>
      </div>
      <div style={{display:"flex",gap:18,alignItems:"center",background:"rgba(255,255,255,0.04)",border:"1.5px solid rgba(255,215,0,0.18)",borderRadius:22,padding:"12px 22px",marginTop:11,backdropFilter:"blur(10px)",zIndex:1,boxShadow:`0 0 18px ${p.color}18`}}>
        <div style={{textAlign:"center",minWidth:76}}>
          <div style={{color:"rgba(255,215,0,0.45)",fontSize:9,marginBottom:2}}>CURRENT TURN</div>
          <div style={{fontSize:20}}>{players?.[cur]?.avatar||"👤"}</div>
          <div style={{color:p.color,fontWeight:900,fontSize:11,textShadow:`0 0 9px ${p.color}`,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:76}}>{players?.[cur]?.name||p.name}</div>
          {isOnline&&!isMyTurn&&<div style={{color:T.t3,fontSize:8,marginTop:2}}>⏳ Unki baari</div>}
        </div>
        <Dice val={dice} rolling={false} onRoll={onRoll} disabled={rolled||(isOnline&&!isMyTurn)} sz={68}/>
        <div style={{textAlign:"center",minWidth:76}}>
          <div style={{color:"rgba(255,215,0,0.45)",fontSize:9,marginBottom:3}}>STATUS</div>
          <div style={{fontSize:20}}>{!rolled?"🎲":movable.length?"👆":"⏳"}</div>
          <div style={{color:T.gold,fontSize:11,fontWeight:700}}>{!rolled?(isOnline&&!isMyTurn?"Unki baari":"Phenko!"):movable.length?"Goti chuno":"..."}</div>
          {turns>0&&<div style={{color:"rgba(255,255,255,0.18)",fontSize:8,marginTop:1}}>Turn #{turns}</div>}
        </div>
      </div>
      <div style={{display:"flex",gap:5,marginTop:9,flexWrap:"wrap",justifyContent:"center",zIndex:1,maxWidth:530}}>
        {REACTIONS.map(e=><button key={e} onClick={()=>onReact(e)} style={{fontSize:19,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.09)",borderRadius:9,padding:"3px 7px",cursor:"pointer",transition:"transform 0.1s"}} className="btnH">{e}</button>)}
      </div>
      <div style={{width:"100%",maxWidth:550,background:"rgba(0,0,0,0.4)",borderRadius:12,padding:"8px 13px",marginTop:9,border:"1px solid rgba(255,255,255,0.05)",maxHeight:78,overflowY:"auto",zIndex:1}}>
        {(log||[]).slice(0,20).map((e,i)=><div key={i} style={{color:i===0?T.gold:`rgba(255,215,0,${Math.max(0.1,0.55-i*0.08)})`,fontSize:i===0?12:10,fontWeight:i===0?700:400,padding:"1px 0",animation:i===0?"dn 0.3s ease":"none"}}>{e}</div>)}
      </div>
      <div style={{color:"rgba(255,255,255,0.1)",fontSize:8,marginTop:7,zIndex:1}}>Ludo Ala v4.0 • {isOnline?"🌐 Online (Supabase)":"🏠 Offline"}</div>
    </div>
  );
}

// ══════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════
export default function App(){
  const [screen,setScreen]=useState("home");
  const [profile,setProfile]=useState(null);
  const [toast,setToast]=useState({msg:"",type:"info"});
  const [gs,setGs]=useState(null);
  const [gamePlayers,setGamePlayers]=useState(null);
  const [mySlot,setMySlot]=useState(0);
  const [isOnline,setIsOnline]=useState(false);
  const [roomCode,setRoomCode]=useState("");
  const [reactions,setReactions]=useState({});
  const [rolling,setRolling]=useState(false);
  const unsubRef=useRef(null);

  useEffect(()=>{
    const p=loadProfile()||defProfile();
    setProfile(p);
  },[]);

  const showToast=useCallback((msg,type="info")=>{ setToast({msg,type}); setTimeout(()=>setToast({msg:"",type:"info"}),2800); },[]);

  // Offline start
  const startOffline=useCallback(({n,players})=>{
    const newGs=mkGS(n);
    const pm={};
    players.forEach(p=>pm[p.id]=p);
    setGs(newGs); setGamePlayers(pm); setMySlot(0); setIsOnline(false); setRoomCode(""); setScreen("game");
  },[]);

  // Parse supabase room data into game state
  const parseRoomToGs=(data)=>{
    const pieces = typeof data.pieces==="string"?JSON.parse(data.pieces):(data.pieces||mkPieces());
    const kills = typeof data.kills==="string"?JSON.parse(data.kills):(data.kills||[0,0,0,0]);
    const scores = typeof data.scores==="string"?JSON.parse(data.scores):(data.scores||[0,0,0,0]);
    const log = typeof data.log==="string"?JSON.parse(data.log):(data.log||[]);
    const players = typeof data.players==="string"?JSON.parse(data.players):(data.players||{});
    const n = Object.keys(players).length||2;
    return {
      pieces, kills, scores, log, n,
      cur: data.current_player||0,
      dice: data.dice_val||null,
      rolled: data.dice_rolled||false,
      winner: data.winner??null,
      turns: data.turns||0,
      start: data.start_time||Date.now(),
    };
  };

  // Online game start from lobby
  const startOnline=useCallback((roomData,slot)=>{
    const players = typeof roomData.players==="string"?JSON.parse(roomData.players):(roomData.players||{});
    const pm={};
    Object.entries(players).forEach(([k,v])=>pm[Number(k)]=v);
    const newGs=parseRoomToGs({...roomData,players});
    setGs(newGs); setGamePlayers(pm); setMySlot(slot); setIsOnline(true); setRoomCode(roomData.code); setScreen("game");

    if(unsubRef.current) unsubRef.current();
    unsubRef.current=sbSubscribe(roomData.code, data=>{
      const pl = typeof data.players==="string"?JSON.parse(data.players):(data.players||{});
      const upm={};
      Object.entries(pl).forEach(([k,v])=>upm[Number(k)]=v);
      setGamePlayers(upm);
      setGs(parseRoomToGs({...data,players:pl}));
      if(data.reactions){
        const reacts = typeof data.reactions==="string"?JSON.parse(data.reactions):data.reactions;
        if(reacts) setReactions(reacts);
      }
    });
  },[]);

  // Dice roll
  const handleRoll=useCallback(()=>{
    if(!gs||rolling||gs.rolled) return;
    if(isOnline&&mySlot!==gs.cur) return;
    setRolling(true);
    let cnt=0;
    const iv=setInterval(()=>{
      const fv=Math.ceil(Math.random()*6);
      setGs(g=>g?{...g,dice:fv}:g);
      if(++cnt>=10){
        clearInterval(iv);
        const v=Math.ceil(Math.random()*6);
        setRolling(false);
        const cpName=gamePlayers?.[gs.cur]?.name||PLAYERS[gs.cur].name;
        const newGs={...gs,dice:v,rolled:true};
        const mv=getMovable(newGs,gs.cur,v);
        const logEntry=mv.length?`${PLAYERS[gs.cur].emoji} ${cpName}: ${v} aaya! Goti chuno 👆`:`${PLAYERS[gs.cur].emoji} ${cpName}: ${v} aaya, no move ❌`;
        newGs.log=[logEntry,...(gs.log||[]).slice(0,19)];
        if(isOnline){
          sbUpdate(roomCode,{dice_val:v,dice_rolled:true,log:JSON.stringify(newGs.log)}).catch(console.error);
        } else {
          setGs(newGs);
          if(!mv.length) setTimeout(()=>setGs(g=>g?nextTurn(g,false):g),900);
          if(mv.length){
            const pd=gamePlayers?.[gs.cur];
            if(pd?.isBot) setTimeout(()=>{ const bm=botAI(newGs,gs.cur,v); if(bm) handlePieceMove(gs.cur,bm.i,newGs); },800);
          }
        }
      }
    },70);
  },[gs,rolling,isOnline,mySlot,gamePlayers,roomCode]);

  // Piece move
  const handlePieceMove=useCallback((pid,idx,gsOverride)=>{
    const cur=gsOverride||gs;
    if(!cur||cur.winner!==null) return;
    if(!isOnline&&pid!==cur.cur) return;
    if(isOnline&&mySlot!==cur.cur) return;
    const mv=getMovable(cur,cur.cur,cur.dice);
    const m=mv.find(x=>x.pid===pid&&x.i===idx);
    if(!m) return;
    let newGs=doMove(cur,pid,idx,m.to);
    const cpName=gamePlayers?.[pid]?.name||PLAYERS[pid].name;
    const logs=[];
    if(m.kill) logs.push(`⚔️ ${cpName} ne goti kaata! +${KILL_PTS}pts 💀`);
    if(newGs.winner!==null){
      logs.push(`🏆 ${cpName} JEET GAYA! 🎊`);
      const up={...profile,gamesPlayed:(profile?.gamesPlayed||0)+1,gamesWon:(profile?.gamesWon||0)+(newGs.winner===mySlot?1:0),totalKills:(profile?.totalKills||0)+(newGs.kills[mySlot]||0),totalScore:(profile?.totalScore||0)+(newGs.scores[mySlot]||0)};
      saveProfile(up); setProfile(up);
      updateLB(profile?.uid||"local",profile?.name||"Player",profile?.avatar||"👤",newGs.scores[mySlot]||0,newGs.winner===mySlot);
    } else {
      logs.push(`${PLAYERS[pid].emoji} ${cpName}: cell ${m.to} pe gayi!`);
    }
    const extra=cur.dice===6&&newGs.winner===null;
    newGs=nextTurn(newGs,extra);
    newGs.log=[...logs,...(newGs.log||[]).slice(0,20-logs.length)];
    if(extra) newGs.log=["🎲 6 aaya! Ek aur chance!",...newGs.log];
    if(isOnline){
      sbUpdate(roomCode,{
        pieces:JSON.stringify(newGs.pieces), current_player:newGs.cur,
        dice_val:newGs.dice, dice_rolled:newGs.rolled, winner:newGs.winner,
        kills:JSON.stringify(newGs.kills), scores:JSON.stringify(newGs.scores),
        log:JSON.stringify(newGs.log), turns:newGs.turns
      }).catch(console.error);
    } else {
      setGs(newGs);
      if(newGs.winner===null){
        const np=gamePlayers?.[newGs.cur];
        if(np?.isBot) setTimeout(()=>handleRoll(),1200);
      }
    }
  },[gs,isOnline,mySlot,gamePlayers,roomCode,profile,handleRoll]);

  // Reaction
  const handleReact=useCallback((emoji)=>{
    setReactions(r=>({...r,[mySlot]:emoji}));
    setTimeout(()=>setReactions(r=>({...r,[mySlot]:null})),2500);
    if(isOnline&&roomCode){
      const newReacts={...reactions,[mySlot]:emoji};
      sbUpdate(roomCode,{reactions:JSON.stringify(newReacts)}).catch(console.error);
      setTimeout(()=>{
        const cleared={...newReacts,[mySlot]:null};
        sbUpdate(roomCode,{reactions:JSON.stringify(cleared)}).catch(console.error);
      },2500);
    }
  },[mySlot,isOnline,roomCode,reactions]);

  // Reset
  const handleReset=useCallback(()=>{
    if(isOnline){ if(unsubRef.current) unsubRef.current(); setScreen("home"); setIsOnline(false); }
    else if(gs&&gamePlayers){ setGs({...mkGS(gs.n),log:["🔄 Reset! Red pehle!"]}); }
  },[isOnline,gs,gamePlayers]);

  return(
    <>
      <Toast msg={toast.msg} type={toast.type}/>
      {screen==="home"&&<Home profile={profile} onNav={setScreen}/>}
      {screen==="setup"&&<Setup profile={profile} onStart={startOffline} onBack={()=>setScreen("home")}/>}
      {screen==="login"&&<Login profile={profile} onLogin={(p)=>{setProfile(p);setScreen("lobby");}} onBack={()=>setScreen("home")} onToast={showToast}/>}
      {screen==="lobby"&&<Lobby profile={profile} onGameStart={startOnline} onBack={()=>setScreen("home")} onToast={showToast}/>}
      {screen==="game"&&gs&&<Board gs={gs} players={gamePlayers} mySlot={mySlot} isOnline={isOnline} roomCode={roomCode} onMove={handlePieceMove} onRoll={handleRoll} onReact={handleReact} reactions={reactions} onHome={()=>{if(unsubRef.current)unsubRef.current();setScreen("home");}} onReset={handleReset}/>}
      {screen==="lb"&&<LBScreen onBack={()=>setScreen("home")} uid={profile?.uid}/>}
      {screen==="rules"&&<Rules onBack={()=>setScreen("home")}/>}
      {screen==="profile"&&<ProfileScreen profile={profile||defProfile()} onUpdate={p=>{setProfile(p);saveProfile(p);}} onBack={()=>setScreen("home")}/>}
    </>
  );
}
