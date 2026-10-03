# 一次性补丁脚本（归档，别直接跑）

这些脚本记录了 `frontend/src/data/datapathLayout.json` 是怎么一步步长成现在这样的。
每个脚本开头的 docstring 写清了"当时撞到什么几何冲突、为什么这么解"，这些推理
在 JSON 和 `explained.md` 里都没有完整保留，所以留档。

**不要直接重跑。** 分两类：

- `_add_trap1.py` / `_add_trap2.py` —— **非幂等**。它们用的是
  `L['modules'].extend(...)`，在当前 JSON 上再跑一次会把 pcmux5/6、trapunit、
  csr、wbmux1 全部复制一份，端口 ID 也会重复（`check_layout.py` 会报"部件 ID 重复"）。
- `_fix_netlabels.py` / `_fix_botleft.py` / `_fix_wbchain.py` —— **幂等**。
  写的全是绝对坐标，重跑只是把同样的值再写一遍。但要改布局的话，改 JSON 更直接。

要回退状态，**别去 `tools/out/` 找快照**——整个 `tools/out/` 在 `.gitignore` 里，
快照不随仓库走（曾经提到的 `datapathLayout.snapshot-2026-09-21.json` 本机也已不在，
git 里也从来没有过）。用 git 取历史版本：

```bash
git log --oneline -- frontend/src/data/datapathLayout.json   # 先看有哪些版本
git show <commit>:frontend/src/data/datapathLayout.json > datapathLayout.old.json
```

取出来的旧版**不要直接覆盖**：先 `python -m json.tool datapathLayout.old.json` 确认是合法 JSON，
再和当前版 diff 看差了什么。注意 `core.autocrlf` 是 system 级 `true`，行尾可能被转换。
