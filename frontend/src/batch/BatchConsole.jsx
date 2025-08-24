// src/batch/BatchConsole.jsx
import React, { useEffect, useRef } from "react";

export default function BatchConsole({ open, onClose, progress, status, logs }) {
  const boxRef = useRef(null);
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [logs]);
  if (!open) return null;
  return (
    <div style={{
      position: 'absolute', right: 0, top: 0, height: '100vh', width: 420, zIndex: 2000,
      background: '#0b1020', color: '#e5e7eb', boxShadow: '0 0 18px rgba(0,0,0,.35)'
    }}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding: '10px 12px', borderBottom: '1px solid #1f2937'}}>
        <div style={{fontWeight:700}}>Batch console</div>
        <button onClick={onClose} style={{background:'#111827', color:'#fff', border:'1px solid #374151', borderRadius:6, padding:'6px 10px', cursor:'pointer'}}>Chiudi</button>
      </div>
      <div style={{padding:'10px 12px'}}>
        <div style={{fontSize:13, opacity:.85, marginBottom:6}}>{status}</div>
        <div style={{height:8, background:'#111827', borderRadius:6, overflow:'hidden', border:'1px solid #1f2937'}}>
          <div style={{height:'100%', width:`${Math.round(progress*100)}%`, background:'#22c55e', transition:'width .2s'}}/>
        </div>
      </div>
      <div ref={boxRef} style={{padding:'10px 12px', height:'calc(100% - 110px)', overflow:'auto', fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize:12, lineHeight:'18px', whiteSpace:'pre-wrap'}}>
        {logs.map((l,i) => (
          <div key={i} style={{opacity: l.level==='warn'?0.9:1, color: l.level==='error' ? '#fca5a5' : l.level==='warn' ? '#fde68a' : '#e5e7eb'}}>
            [{new Date(l.ts).toLocaleTimeString()}] {l.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
