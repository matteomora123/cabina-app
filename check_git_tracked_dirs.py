import subprocess
from pathlib import Path
from collections import defaultdict

def get_tracked_files():
    result = subprocess.run(["git", "ls-files"], capture_output=True, text=True)
    return [Path(line.strip()) for line in result.stdout.splitlines() if line.strip()]

def build_dir_structure(files):
    dir_tree = defaultdict(set)
    for file in files:
        parts = file.parts
        if len(parts) > 1:
            dir_tree[parts[0]].add(parts[1] if len(parts) > 2 else "(file)")
    return dir_tree

def get_total_size_by_root(files):
    sizes = defaultdict(int)
    for file in files:
        try:
            size = file.stat().st_size
            root = file.parts[0] if len(file.parts) > 0 else "(root)"
            sizes[root] += size
        except FileNotFoundError:
            continue
    return sizes

def format_size(bytes_size):
    gb = bytes_size / (1024 ** 3)
    return f"{gb:.2f} GB"

def main():
    files = get_tracked_files()
    dir_tree = build_dir_structure(files)
    root_sizes = get_total_size_by_root(files)

    print("📦 Cartelle tracciate da Git e relative prime sottocartelle:\n")
    for root in sorted(dir_tree):
        print(f"📁 {root}/")
        for sub in sorted(dir_tree[root]):
            print(f"   └── {sub}/")
        if root in root_sizes:
            print(f"   📏 Dimensione totale: {format_size(root_sizes[root])}")

    total = sum(root_sizes.values())
    print("\n📊 Totale dimensione tracciata da Git:")
    print(f"   💾 {format_size(total)}")

    if total > 200 * 1024 ** 2:
        print("⚠️ ATTENZIONE: Repository pesante! Valuta `git rm -r --cached NOME_CARTELLA`.\n")

if __name__ == "__main__":
    main()
