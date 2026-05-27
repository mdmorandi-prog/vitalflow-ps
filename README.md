# VitalFlow PS
**Vitalliz — Engenharia de Dados**  
Dashboard de Gestão de Tempos · Pronto Socorro

---

## Como Usar

1. Abra o arquivo `index.html` em qualquer navegador moderno (Chrome, Edge, Firefox)
2. Faça login com uma das credenciais abaixo
3. Clique em **Carregar CSV** e selecione o arquivo `tempos_atendimento_sus.csv`
4. O dashboard será populado automaticamente com todos os dados e KPIs

> **Dica:** Você também pode arrastar e soltar o arquivo CSV diretamente na tela de carregamento.

---

## Credenciais de Acesso

| Usuário   | Senha           | Perfil              |
|-----------|-----------------|---------------------|
| `admin`   | `vitalliz@2026` | Administrador        |
| `gestao`  | `ps@2026`       | Gestão de Unidade   |
| `viewer`  | `viewer@2026`   | Acesso Leitura      |

> **Importante:** Para publicação em produção, substitua este sistema de autenticação estático por um backend seguro (ex: Firebase Auth, Supabase, Auth0).

---

## Funcionalidades

### KPIs ANAHP
- **Tempo Médio Ficha → Médico** — Meta: ≤ 30min
- **Conformidade ≤ 30min** — Meta: ≥ 80%
- **Permanência Média Total** — Meta: ≤ 4h
- **Total de Atendimentos** — Volume do período
- **Horário de Pico** — Concentração de demanda
- **Melhor Mês** — Menor tempo médio registrado

### Gráficos
- **Tendência Mensal** — Evolução do tempo médio e conformidade mês a mês
- **Desempenho por Especialidade** — Comparativo entre especialidades
- **Mapa de Calor** — Demanda por hora × dia da semana
- **Distribuição dos Tempos** — Histograma por faixas de tempo
- **Evolução Diária** — Volume e tempo médio dia a dia
- **Análise por Dia da Semana** — Ranking de dias

### Tabela
- **Top 10 Dias Críticos** — Dias com maior tempo médio de espera

### Filtros
- Por **Mês** — Janeiro a Maio
- Por **Especialidade** — Clínica Geral, Pediatria, Ortopedia etc.

---

## Formato CSV Esperado

Delimitador: `;` (ponto-e-vírgula)

| Coluna | Campo |
|--------|-------|
| 1 | SEMANA_MES |
| 2 | DIA_SEMANA |
| 3 | DATA (DD.MM.YYYY) |
| 4 | ATENDIMENTO |
| 5 | PACIENTE |
| 6 | ESPECIALIDADE |
| 7 | HORA_ENTRADA |
| 8 | PACIENTE_TEMPO_FICHA_ATE_MEDICO |
| 9 | PACIENTE_TEMPO_PERMANENCIA_TOTAL |
| 10 | TOTAL_ATENDIMENTOS_DO_DIA |
| 11 | DIA_TEMPO_MED_FICHA_ATE_MEDICO |

---

## Tecnologias

- HTML5 + CSS3 Vanilla (Dark Mode Premium)
- JavaScript ES6+ (sem frameworks)
- [Chart.js 4.4](https://www.chartjs.org/) — Visualizações
- [PapaParse 5.4](https://www.papaparse.com/) — Parsing CSV

---

© 2026 Vitalliz Engenharia de Dados
