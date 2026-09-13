// Importa o Express, que cria nosso pequeno servidor web.
import express from "express";

// Importa o dotenv, que lê a chave salva no arquivo .env.
import dotenv from "dotenv";

// Importa o cliente oficial atual do Gemini.
import { GoogleGenAI } from "@google/genai";

// Carrega as variáveis do arquivo .env para process.env.
dotenv.config();

// Cria a aplicação Express.
const app = express();

// Define a porta local do projeto.
const PORT = 3000;

// Cria o cliente Gemini usando a chave protegida no servidor.
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

// Permite ao servidor receber JSON enviado pelo front-end.
app.use(express.json());

// Faz a pasta public virar a pasta pública do site.
app.use(express.static("public"));

// ============================================================
// 1) PERSONALIDADE DO AGENTE
// Edite SOMENTE este bloco para trocar o tema do agente.
// ============================================================

// Guarda as principais configurações do agente.
  // Nome que o agente usa ao se apresentar.
 const AGENT_CONFIG = {
  nome: "TutoL",

  missao:
    "Ajudar pessoas que tem dificuldade em aprender.",

  estilo:
    "3 cores principais: #0030FF, #011159 e #0073FF. Titulo: TutoL📚. Não escreva JavaScript. Não altere IDs do HTML",
};

// Monta a instrução de sistema a partir da configuração acima.
const SYSTEM_INSTRUCTION = `
Você é ${AGENT_CONFIG.nome}.
Sua missão é: ${AGENT_CONFIG.missao}
Seu estilo é: ${AGENT_CONFIG.estilo}

REGRA DE FORMATAÇÃO OBRIGATÓRIA:
Responda sempre usando HTML puro para formatar o texto (tags como <h3>, <p>, <strong>, <ul>, <li>, <div style="...">).
NUNCA use símbolos de Markdown como #, ##, **, --- ou similares.
Todo negrito deve usar <strong>, todo título deve usar <h1>/<h2>/<h3>, toda lista deve usar <ul>/<li>.

Você é um microagente, não apenas um chatbot.
Você pode decidir usar ferramentas quando isso ajudar a cumprir sua missão.

Ferramentas disponíveis:
1. salvar_memoria: use quando o usuário pedir para lembrar algo importante,
   informar uma preferência ou declarar um objetivo que será útil depois.
2. listar_memoria: use quando o usuário perguntar o que você lembra,
   pedir um resumo das informações guardadas ou quando recuperar memória
   ajudar diretamente na tarefa atual.

Nunca invente uma memória.
Nunca diga que salvou algo se a ferramenta não tiver sido usada.
Não peça nem armazene senhas, chaves de API ou dados pessoais sensíveis.
`;

// ============================================================
// 2) MEMÓRIA LOCAL DO NOSSO AGENTE
// ============================================================

// Cria um Map para guardar memórias separadas por sessão.
const memoriasPorSessao = new Map();

// Retorna o array de memórias de uma sessão.
function obterMemorias(sessionId) {
  // Se a sessão ainda não existir, cria um array vazio.
  if (!memoriasPorSessao.has(sessionId)) {
    memoriasPorSessao.set(sessionId, []);
  }

  // Devolve as memórias daquela sessão.
  return memoriasPorSessao.get(sessionId);
}

// ============================================================
// 3) FERRAMENTAS QUE O MODELO PODE ESCOLHER USAR
// ============================================================

// Descreve a ferramenta salvar_memoria para o Gemini.
const salvarMemoriaTool = {
  // Informa que esta ferramenta é uma função do nosso código.
  type: "function",

  // Nome que o modelo usará quando quiser chamar a função.
  name: "salvar_memoria",

  // Explica ao modelo quando esta função é útil.
  description:
    "Salva uma informação curta que será útil em mensagens futuras desta mesma sessão.",

  // Define quais argumentos a função recebe.
  parameters: {
    // Os argumentos chegam como um objeto.
    type: "object",

    // Define os campos existentes nesse objeto.
    properties: {
      // Cria o argumento chamado informacao.
      informacao: {
        // O valor precisa ser texto.
        type: "string",

        // Explica ao modelo o conteúdo esperado.
        description:
          "Informação curta e útil para lembrar depois, sem dados sensíveis.",
      },
    },

    // Obriga o modelo a fornecer o campo informacao.
    required: ["informacao"],
  },
};

// Descreve a ferramenta listar_memoria para o Gemini.
const listarMemoriaTool = {
  // Também é uma função do nosso código.
  type: "function",

  // Nome usado pelo modelo.
  name: "listar_memoria",

  // Explica a finalidade.
  description:
    "Retorna as memórias já salvas para a sessão atual.",

  // Esta ferramenta não precisa receber argumentos.
  parameters: {
    // Mesmo sem campos, os argumentos continuam sendo um objeto.
    type: "object",

    // O objeto não possui propriedades obrigatórias.
    properties: {},
  },
};

// Agrupa as duas ferramentas em um array.
const TOOLS = [salvarMemoriaTool, listarMemoriaTool];

// Executa no nosso servidor a ferramenta escolhida pelo modelo.
function executarFerramenta(chamada, sessionId) {
  // Busca as memórias da sessão atual.
  const memorias = obterMemorias(sessionId);

  // Verifica se o modelo escolheu salvar_memoria.
  if (chamada.name === "salvar_memoria") {
    // Lê o argumento informacao enviado pelo modelo.
    const informacao = chamada.arguments?.informacao?.trim();

    // Evita salvar texto vazio.
    if (!informacao) {
      return { sucesso: false, mensagem: "Nenhuma informação foi recebida." };
    }

    // Adiciona a informação ao array da sessão.
    memorias.push(informacao);

    // Retorna o resultado da ferramenta para o modelo.
    return {
      sucesso: true,
      mensagem: "Memória salva.",
      total_memorias: memorias.length,
    };
  }

  // Verifica se o modelo escolheu listar_memoria.
  if (chamada.name === "listar_memoria") {
    // Retorna uma cópia das memórias salvas.
    return {
      sucesso: true,
      memorias: [...memorias],
    };
  }

  // Caso apareça uma ferramenta desconhecida, retorna erro controlado.
  return {
    sucesso: false,
    mensagem: `Ferramenta desconhecida: ${chamada.name}`,
  };
}

// ============================================================
// 4) ROTA DO AGENTE
// Browser -> nosso servidor -> Gemini -> ferramenta -> Gemini
// ============================================================

// Cria a rota POST /api/agent.
app.post("/api/agent", async (req, res) => {
  // Lê os dados enviados pelo front-end.
  const { mensagem, sessionId, previousInteractionId } = req.body;

  // Impede chamadas sem mensagem.
  if (!mensagem?.trim()) {
    return res.status(400).json({
      erro: "Digite uma mensagem antes de enviar.",
    });
  }

  // Impede chamadas sem identificador de sessão.
  if (!sessionId) {
    return res.status(400).json({
      erro: "A sessão do agente não foi informada.",
    });
  }

  try {
    // Faz a primeira interação com o Gemini.
    let interaction = await ai.interactions.create({
      // Usa um modelo Flash atual com suporte a function calling.
      model: "gemini-3.8-flash",

      // Envia a mensagem digitada pelo usuário.
      input: mensagem,

      // Define missão, regras e comportamento do agente.
      system_instruction: SYSTEM_INSTRUCTION,

      // Entrega ao modelo a lista de ferramentas disponíveis.
      tools: TOOLS,

      // Liga esta mensagem à conversa anterior, quando existir.
      previous_interaction_id: previousInteractionId || undefined,
    });

    // Cria um array para mostrar na interface quais ferramentas foram usadas.
    const ferramentasUsadas = [];

    // Permite até 3 rodadas de ferramenta para evitar loop infinito.
    for (let rodada = 0; rodada < 3; rodada++) {
      // Procura uma chamada de função entre os passos retornados pelo modelo.
      const chamada = interaction.steps?.find(
        (step) => step.type === "function_call"
      );

      // Se não houver ferramenta para executar, a resposta já está pronta.
      if (!chamada) {
        break;
      }

      // Registra o nome da ferramenta escolhida.
      ferramentasUsadas.push(chamada.name);

      // Executa a função real no nosso servidor.
      const resultadoFerramenta = executarFerramenta(
        chamada,
        sessionId
      );

      // Devolve ao Gemini o resultado da ferramenta.
      interaction = await ai.interactions.create({
        // Mantém o mesmo modelo.
        model: "gemini-3.8-flash",

        // Continua exatamente a interação que pediu a ferramenta.
        previous_interaction_id: interaction.id,

        // Informa ao modelo o resultado da função executada.
        input: [
          {
            // Diz que este item é o resultado de uma ferramenta.
            type: "function_result",

            // Repete o nome da função chamada.
            name: chamada.name,

            // Liga o resultado à chamada correta.
            call_id: chamada.id,

            // Envia o resultado como texto JSON.
            result: [
              {
                // O resultado será enviado como texto.
                type: "text",

                // Converte o objeto JavaScript em JSON.
                text: JSON.stringify(resultadoFerramenta),
              },
            ],
          },
        ],

        // Mantém as ferramentas disponíveis caso o agente precise de outra.
        tools: TOOLS,
      });
    }

    // Busca a memória atual para exibir no painel lateral.
    const memorias = obterMemorias(sessionId);

    // Envia a resposta final para o navegador.
    return res.json({
      // Texto final produzido pelo agente.
      resposta:
        interaction.output_text || "O agente não retornou texto.",

      // ID usado para continuar a conversa na próxima mensagem.
      interactionId: interaction.id,

      // Lista de ferramentas que o agente decidiu utilizar.
      ferramentasUsadas,

      // Memórias atuais desta sessão.
      memorias,
    });
  } catch (erro) {
  // Mostra o erro completo no terminal do servidor.
  console.error(erro);

  // Verifica se o erro é de cota/limite excedido (código 429).
  const ehLimiteDeCota =
    erro?.status === 429 ||
    erro?.message?.includes("429") ||
    erro?.message?.includes("RESOURCE_EXHAUSTED") ||
    erro?.message?.includes("quota");

  // Retorna uma mensagem amigável se for limite de cota, senão a mensagem padrão.
  return res.status(ehLimiteDeCota ? 429 : 500).json({
    erro: ehLimiteDeCota
      ? "Espere e tente novamente."
      : erro?.message || "Não foi possível conversar com o Gemini.",
  });
}
});

// ============================================================
// 5) INICIAR O SERVIDOR
// ============================================================

// Coloca o servidor para escutar a porta definida no início.
app.listen(PORT, () => {
  // Mostra no terminal o endereço que o aluno deve abrir.
  console.log(`Agente rodando em http://localhost:${PORT}`);
});