Atlaix Intelligence Platform


About Atlaix

Atlaix is an AI-powered intelligence platform built to interpret crypto market behavior in real time. Our system is engineered to solve the problem of signal vs. noise. We continuously analyze on-chain activity, wallet cohorts, liquidity dynamics, and social narratives, synthesizing these signals into structured, verifiable market intelligence.

This repository contains the source code for the Atlaix platform.

Project Status: Functional MVP (Path to Closed Beta)

The Atlaix platform is currently in a functional MVP stage, with a clear and immediate roadmap to launching our Closed Beta.

The objective of this MVP stage is to finalize the core data engines and build out the foundational modules. This is a heads-down development phase focused on engineering excellence.

Current Engineering Focus & Goals for Closed Beta Launch:


Solidify the Core Engines: Harden and optimize our proprietary Detection Engine, Smart Money Engine, and The Gauntlet.

Build Out V1 Modules: Complete the initial, functional versions of our six core modules.

Prepare AI Architecture: Lay the foundational groundwork for the AI Synthesis Layer integration.

Achieve System Stability: Ensure the end-to-end data pipeline is stable, reliable, and ready for our first beta testers.

Completing these objectives will mark the end of the MVP phase and the official start of our Closed Beta.

Architecture & Tech Stack

The Atlaix platform is engineered on a modern, scalable, and decoupled architecture. We leverage best-in-class managed services to ensure reliability and focus our engineering efforts on our proprietary intelligence logic.

Platform Architecture:

Frontend & Serverless API: Netlify

Core Database & Auth: Supabase (PostgreSQL)

Long-Running Workers: Render (Background Worker service)

Job Queue: CloudAMQP (RabbitMQ)

Caching Layer: Redis Cloud

On-Chain Data Provider: Moralis

Off-Chain Data Provider: Twitter/X API

Current Local Runtime Note:

The repository currently runs as a Vite frontend with a local Node forensic worker for Safe Scan. Some infrastructure listed above reflects the intended production target architecture, not every component that is already wired into the local development runtime.

Core Technologies:

Language: TypeScript

Frontend: React (built with Vite)

Backend: Node.js (for background workers and serverless functions)

Styling: CSS Modules


##  Installation & Setup

To run this project locally, follow these steps:

1.  Clone the repository:
    
    git clone https://github.com/Atlaix/Atlaix-platform.git
    cd Atlaix-platform
    

2.  Install dependencies:
    
       npm install
    

3.  Environment Configuration:
    Create a .env.local file in the root directory and add your API keys:
    
    VITE_MORALIS_KEY=your_moralis_key
    VITE_ALCHEMY_KEY=your_alchemy_key
    VITE_GOPLUS_KEY=your_goplus_app_key
    VITE_GOPLUS_SECRET=your_goplus_app_secret
    VITE_SUPABASE_URL=your_supabase_project_url
    VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
    
    >  Note: Ask the team lead for the required keys if you don't have them. Keep service-role keys on backend-only infrastructure and do not expose them through `VITE_` environment variables.

4.  Run the development server:
    
    npm run dev
    

##  Contribution Guidelines

All code contributions must be made through Pull Requests (PRs) from a feature branch to the develop branch:

1.  Branch: Always create a new branch for your feature (git checkout -b feature/my-new-feature).
2.  Commit: Write clear, descriptive commit messages.
3. Push your branch and open a PR for review.
4. All PRs require at least one approval from another team member before being merged.

##  License

This project is proprietary and confidential. Unauthorized copying of files via any medium is strictly prohibited.
