# AuroraCraft

## Overview

AuroraCraft is an agentic AI platform for generating, editing, and compiling Minecraft plugins using Java 21 and Maven. The platform features a chat-based interface where users interact with AI to create complex plugins supporting multiple server frameworks (Paper, Bukkit, Spigot, Folia, Velocity, BungeeCord, etc.). Future expansion includes Discord bots, Chrome extensions, and web apps.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state and caching
- **Styling**: Tailwind CSS with CSS variables for theming (dark/light mode support)
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Build Tool**: Vite with React plugin

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **HTTP Server**: Node.js native HTTP server wrapping Express
- **API Pattern**: RESTful JSON APIs under `/api` prefix
- **Session Management**: Express sessions with PostgreSQL session store (connect-pg-simple)
- **Authentication**: Local username/email/password authentication via Passport.js

### Database Layer
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with drizzle-zod for schema validation
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Migrations**: Drizzle Kit with `db:push` command

### Key Data Models
- Users (with admin roles and token balances)
- Providers (AI provider configurations with API keys)
- Models (AI model definitions linked to providers)
- Chat Sessions and Messages
- Project Files (generated code files)
- Compilations (build results)
- Token Usage tracking
- Site Settings

### Build System
- **Development**: tsx for running TypeScript directly
- **Production Build**: esbuild for server bundling, Vite for client
- **Output**: `dist/` directory with `index.cjs` (server) and `public/` (client assets)

### Project Structure
```
client/           # React frontend application
  src/
    components/   # UI components (shadcn/ui)
    pages/        # Route components
    hooks/        # Custom React hooks
    lib/          # Utilities and query client
server/           # Express backend
  index.ts        # Server entry point
  routes.ts       # API route definitions
  storage.ts      # Database operations
  db.ts           # Drizzle database connection
  prompts.ts      # AI prompt builder with context-aware system prompts
shared/           # Shared code between client/server
  schema.ts       # Drizzle database schema
```

### AI Prompt System
The `server/prompts.ts` module provides context-aware prompt generation:
- **buildSystemPrompt(mode, context)**: Builds comprehensive system prompts with project context (files, messages, compilations)
- **buildEnhancePrompt(framework)**: Generates prompts for enhancing user requests
- **buildErrorFixPrompt(errors, files)**: Creates prompts for fixing compilation errors

Three chat modes:
- **Agent Mode**: Full autonomous implementation with multi-phase workflows
- **Plan Mode**: Architecture and design without implementation
- **Question Mode**: Q&A about Minecraft plugin development

## External Dependencies

### AI Integration
- **OpenAI SDK**: For AI model interactions
- **Google Generative AI**: Alternative AI provider support
- Custom provider system allowing admin-configured AI endpoints

### Authentication
- Local username/email/password authentication
- Session persistence in PostgreSQL

### Database
- **PostgreSQL**: Primary database (requires `DATABASE_URL` environment variable)
- **connect-pg-simple**: Session storage adapter

### File Generation
- **Archiver**: ZIP file creation for project downloads

### Environment Variables Required
- `DATABASE_URL`: PostgreSQL connection string
- `SESSION_SECRET`: Express session secret