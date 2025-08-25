# generate_project_summary.py
#!/usr/bin/env python3
import argparse, os, sys, stat, hashlib, json, datetime
from datetime import date

DEFAULT_EXTS = {".py",".js",".jsx",".ts",".tsx",".css",".html",".md",".json",".yaml",".yml"}

def is_probably_text(path, chunk=4096):
    try:
        with open(path,"rb") as f: data=f.read(chunk)
        return b"\x00" not in data
    except: return False

def rel_walk(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d.lower()!="output"]
        dirnames.sort(); filenames.sort()
        yield dirpath, dirnames, filenames

def sha256_of_file(path, chunk=65536):
    h=hashlib.sha256()
    with open(path,"rb") as f:
        for b in iter(lambda:f.read(chunk),b""): h.update(b)
    return h.hexdigest()

def should_include(path,exts):
    base=os.path.basename(path).lower()
    if base in {"makefile","dockerfile","readme","license"}: return True
    return os.path.splitext(base)[1] in exts

def dump_file(out, root, full, max_bytes):
    try: st=os.stat(full)
    except: return
    if not stat.S_ISREG(st.st_mode): return
    if not is_probably_text(full): return
    size=st.st_size
    try: digest=sha256_of_file(full)
    except Exception: digest="unavailable"
    rel=os.path.relpath(full, root)

    out.write("="*80+"\n")
    out.write(f"File: {rel}\nSize: {size} bytes\nSHA256: {digest}\n\n")
    # Istruzioni operative per le future risposte
    out.write("# ISTRUZIONI OPERATIVE\n")
    out.write("# Quando proponi modifiche:\n")
    out.write("#  - restituisci codice pronto per copia/incolla;\n")
    out.write(f"#  - indica sempre questo file: {rel} e la riga dopo cui inserire la modifica.\n\n")

    try:
        with open(full,"r",encoding="utf-8",errors="replace") as f:
            content=f.read(max_bytes) if max_bytes else f.read()
        out.write(content.rstrip()+"\n")
    except Exception as e:
        out.write(f"[Errore lettura: {e}]\n")

    out.write("\n"+"="*80+"\n")

def process_backend(root, out, max_bytes, summary):
    target=os.path.join(root,"backend")
    if not os.path.isdir(target): return
    out.write("\n### Sezione: backend\n\n")
    for dirpath,_,filenames in rel_walk(target):
        for fn in filenames:
            full=os.path.join(dirpath,fn)
            if not should_include(full, DEFAULT_EXTS): continue
            dump_file(out, root, full, max_bytes)
            summary["files"].append(os.path.relpath(full,root))

def process_frontend_src_app(root, out, max_bytes, summary):
    target=os.path.join(root,"frontend","src")
    if not os.path.isdir(target): return
    out.write("\n### Sezione: frontend/src (solo App.js)\n\n")
    wanted=None
    for dirpath,_,filenames in rel_walk(target):
        for fn in filenames:
            if fn.lower()=="app.js":
                wanted=os.path.join(dirpath,fn); break
        if wanted: break
    if wanted:
        dump_file(out, root, wanted, max_bytes)
        summary["files"].append(os.path.relpath(wanted,root))

def main():
    ap=argparse.ArgumentParser(description="Riepilogo testo progetto: backend + frontend/src/App.js")
    ap.add_argument("root")
    ap.add_argument("output")  # mantenuto per compatibilità, ma ignorato
    ap.add_argument("--max-bytes",type=int,default=None)
    args=ap.parse_args()
    root=os.path.abspath(args.root)

    # Path fisso: ./output_contesto, file YYYYMMDD_progressivo.txt
    out_dir = os.path.join(root, "output_contesto")
    os.makedirs(out_dir, exist_ok=True)
    today = date.today().strftime("%Y%m%d")
    n = 1
    while True:
        out_path = os.path.join(out_dir, f"{today}_{n}.txt")
        if not os.path.exists(out_path): break
        n += 1

    meta_summary = {
        "root": root,
        "generated_at": datetime.datetime.utcnow().isoformat()+"Z",
        "sections": ["backend","frontend/src(App.js)"],
        "files": []
    }

    try:
        with open(out_path,"w",encoding="utf-8",errors="replace") as out:
            # Intestazione per nuova chat
            out.write("### ISTRUZIONI IA ###\n")
            out.write("Agisci come assistente di programmazione. Questo file è il contesto iniziale.\n")
            out.write("Contiene: backend completo e solo App.js (frontend/src).\n")
            out.write("Rimani in attesa: non proporre modifiche finché non richiesto.\n")
            out.write("Quando richiesto, rispondi sempre con:\n")
            out.write(" - codice pronto per copia/incolla;\n")
            out.write(" - file da modificare e riga dopo cui inserire la modifica.\n\n")

            # Metadati JSON
            out.write("### METADATI ###\n")
            out.write(json.dumps(meta_summary, indent=2)+"\n\n")

            # Sezioni codice
            process_backend(root,out,args.max_bytes,meta_summary)
            process_frontend_src_app(root,out,args.max_bytes,meta_summary)

            # Hash cumulativo
            concat = "".join(meta_summary["files"]).encode()
            meta_summary["global_hash"] = hashlib.sha256(concat).hexdigest()
            out.write("\n### METADATI FINALI ###\n")
            out.write(json.dumps(meta_summary, indent=2)+"\n")

        print(out_path)
    except Exception as e:
        print("Errore:",e,file=sys.stderr); sys.exit(1)

if __name__=="__main__": main()
