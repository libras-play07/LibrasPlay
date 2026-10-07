# Atualização Librix — LibrasPlay 3.0

Arquivos alterados:
- server.js
- public/app.js
- public/jogo.html
- public/style.css

Recompensas:
- 5 Librix por acerto
- 20 Librix por concluir as 10 rodadas
- 50 Librix extras ao fazer 10/10

O saldo é salvo no SQLite por nome de jogador.

Para aplicar:
1. Faça backup do projeto.
2. Copie estes arquivos para as mesmas pastas do projeto.
3. Reinicie o servidor com `npm start`.
4. Digite o nome do jogador e inicie uma partida.


## Loja Librix
A atualização também adiciona:
- `public/loja.html`
- botão Loja na carteira do jogo
- 3 itens iniciais
- compras salvas no SQLite
- desconto automático do saldo
- bloqueio de compra repetida
