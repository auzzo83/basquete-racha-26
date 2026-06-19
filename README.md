# Racha Basquete 2026

Site estatico para GitHub Pages com jogos, classificacao, estatisticas e regulamento do Campeonato Interno de Basquete Racha 2026.

## Publicacao segura no GitHub Pages

1. Suba apenas a pasta `racha-basquete-2026` para um repositorio publico do GitHub.
2. Em `Settings > Pages`, selecione `Deploy from a branch`, branch `main`, pasta `/root`.
3. O site nao tem backend, formulario, cookie, tracking, chave de API ou dependencia externa.

## Editar placares futuros

Opcao mais simples no GitHub: edite `data/placares.csv` direto pelo navegador. Altere apenas:

- `Data Real`
- `Placar Mandante`
- `Placar Visitante`
- `Status`
- `Observacoes`

Use `Status` como `Final` quando os dois placares estiverem preenchidos. Ao salvar o arquivo no GitHub, o GitHub Pages passa a mostrar a nova classificacao.

Opcao por planilha: use `placares-editaveis.xlsx` para atualizar jogos futuros. Depois de editar, rode:

```powershell
node .\scripts\update-site-data-from-workbook.mjs
```

Depois suba os arquivos atualizados para o GitHub. Em um repositorio publico, qualquer pessoa consegue ver os dados, mas so quem tem permissao de escrita consegue alterar o que aparece no site.

## Atualizar site com novos PDFs

1. Coloque os novos box scores FIBA na pasta `pdfs/`.
2. Mantenha o PDF de classificacao/calendario tambem dentro de `pdfs/`.
3. Dê duplo clique em `atualizar-site.bat`.
4. O script atualiza automaticamente `data/championship-data.js` e `data/placares.csv`, faz commit e envia para o GitHub.
5. Aguarde 1 a 3 minutos para o GitHub Pages publicar.

Observacao: a coluna `Data Real` do CSV nao e mais preenchida automaticamente. Assim o site nao marca jogos como remarcados sozinho.

## Fontes de dados

- PDF de classificacao `1o semestre classificacao 2026 alteracoes 14 04`.
- Box scores FIBA enviados pelo usuario.
- Imagens do regulamento enviadas pelo usuario.

Jogos identificados como `Torneio Inicio` foram mantidos fora da classificacao oficial.
