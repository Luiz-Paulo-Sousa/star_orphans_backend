# Star Orphans — Backend Stack

Repositório central de microsserviços, APIs REST, servidor WebSocket e orquestração Docker do jogo **Star Orphans**.

---

## 🛰️ Arquitetura dos Serviços

| Serviço | Porta | Descrição |
| :--- | :--- | :--- |
| **APIs (`apis`)** | `8020` | API principal do jogo em Node.js / Express, rotas modularizadas de autenticação, perfis, mensageria, servidor WebSocket em tempo real e hospedagem de arquivos estáticos da versão Web/PWA do Companion App. |
| **Auth (`auth`)** | `8010` | Microsserviço de autenticação e geração de tokens. |
| **MariaDB (`mariadb`)** | `3306` | Banco de dados relacional (contas, pilotos, mensagens, inventários, facções, prestígio). |
| **RabbitMQ (`rabbitmq`)** | `5672` / `15672` | Message broker para comunicação assíncrona de eventos. |

---

## 📁 Estrutura de Pastas

```text
star_orphans_backend/
├── apis/
│   ├── dockerfile
│   └── src/
│       ├── config/          # Conexão com MariaDB
│       ├── controllers/     # authController, messageController, profileController
│       ├── middleware/      # upload de avatares, validações
│       ├── public/          # Assets estáticos do Companion Web (PWA)
│       ├── routes/          # authRoutes, messageRoutes, profileRoutes, recoveryRoutes
│       ├── services/        # codeService, envio de e-mails
│       ├── storage/uploads/ # Armazenamento de avatares dos pilotos
│       ├── app.js           # Configuração do Express, CORS, Helmet e SPA Fallback
│       └── server.js        # Inicialização do servidor HTTP e WebSocket na porta 8020
├── auth/
│   ├── dockerfile
│   └── src/                 # Microsserviço de autenticação
├── mariadb/
│   └── sql/                 # Scripts de inicialização e migrações SQL
├── docker-compose.yml       # Orquestrador da stack no servidor
├── deploy-to-server.ps1     # Script de sincronização com o servidor de produção
└── .gitignore
```

---

## 🚀 Execução em Ambiente Docker

Para subir a stack completa:
```bash
docker compose up -d --build
```

Para verificar os logs do serviço de APIs:
```bash
docker logs -f apis_novas
```
