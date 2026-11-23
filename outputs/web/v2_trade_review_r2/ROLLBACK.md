# GO-Web-V2-R2 回滚方式

站点修复提交仅改 `app.js`、`styles.css`，新增 `data/v2_trade_notes.json`，可逆、无需强推。

```sh
cd /Users/z/GoldOne
# 回滚站点修复（保留校验记录）
git revert --no-edit <SITE_FIX_COMMIT>
git push origin master
```

回滚后应恢复：

- `app.js` = `bf84380c0ee8af0ad13b44dc84138d6b7dc64b13437becd3eb447bc7ede73bb0`
- `styles.css` = `008e90fb7a679a8641993a97951acd15122f4bdb231be09e88205a44707ae135`
- `data/v2_review.json` = `be996e677f184122b9bfa9951eff450280f305e573ecbe0256449b1a4964cbae`
- 删除新增的 `data/v2_trade_notes.json`

发布根与 P21 维护源 `outputs/web/v2_frozen_review/site/` 保持字节一致，避免下次本地构建恢复旧问题。
