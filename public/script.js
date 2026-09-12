// Busca o formulário do chat pelo id.
const formulario = document.querySelector("#agentForm");

// Busca o campo onde o usuário digita a mensagem.
const campoMensagem = document.querySelector("#userInput");

// Busca a área que exibe as mensagens da conversa.
const areaMensagens = document.querySelector("#messages");

// Busca o botão de enviar.
const botaoEnviar = document.querySelector("#sendButton");

// Busca a área que mostra o estado da requisição.
const statusTexto = document.querySelector("#statusText");

// Busca a área que mostra a última ferramenta usada.
const toolTexto = document.querySelector("#toolText");

// Busca a lista visual de memórias.
const listaMemorias = document.querySelector("#memoryList");

// Guarda o ID da interação anterior.
// Ele começa nulo porque ainda não existe conversa anterior.
let previousInteractionId = null;

// Cria um identificador único para esta sessão no navegador.
const sessionId = crypto.randomUUID();

// Cria uma bolha de mensagem na tela.
function adicionarMensagem(tipo, texto) {
  // Cria uma nova div.
  const bolha = document.createElement("div");

  // Adiciona as classes de estilo da bolha.
  bolha.className = `message ${tipo}`;

 // Se for mensagem do agente, renderiza como HTML (ele responde com formatação).
  // Se for do usuário ou erro, mantém como texto puro por segurança.
  if (tipo === "agent") {
    bolha.innerHTML = texto;
  } else {
    bolha.textContent = texto;
  }

  // Insere a bolha na área de mensagens.
  areaMensagens.appendChild(bolha);

  // Faz a conversa rolar automaticamente até a última mensagem.
  areaMensagens.scrollTop = areaMensagens.scrollHeight;
}

// Atualiza o painel lateral de memórias.
function atualizarMemorias(memorias) {
  // Limpa a lista antes de redesenhar.
  listaMemorias.innerHTML = "";

  // Se não houver memória, mostra uma mensagem simples.
  if (!memorias.length) {
    // Cria um item vazio.
    const item = document.createElement("li");

    // Explica que nada foi salvo ainda.
    item.textContent = "Nenhuma memória salva.";

    // Coloca o item na lista.
    listaMemorias.appendChild(item);

    // Encerra a função.
    return;
  }

  // Percorre cada memória recebida do servidor.
  memorias.forEach((memoria) => {
    // Cria um item de lista.
    const item = document.createElement("li");

    // Exibe o conteúdo da memória.
    item.textContent = memoria;

    // Adiciona o item ao painel.
    listaMemorias.appendChild(item);
  });
}

// Ativa ou desativa o estado de carregamento.
function definirCarregando(carregando) {
  // Desabilita o botão durante a requisição.
  botaoEnviar.disabled = carregando;

  // Desabilita o campo para evitar envio duplicado.
  campoMensagem.disabled = carregando;

  // Troca o texto do botão.
  botaoEnviar.textContent = carregando
    ? "Pensando..."
    : "Enviar";

  // Mostra o estado atual da aplicação.
  statusTexto.textContent = carregando
    ? "loading"
    : "idle";
}

// Escuta o envio do formulário.
formulario.addEventListener("submit", async (evento) => {
  // Impede o navegador de recarregar a página.
  evento.preventDefault();

  // Lê a mensagem e remove espaços extras.
  const mensagem = campoMensagem.value.trim();

  // Não envia texto vazio.
  if (!mensagem) {
    return;
  }

  // Mostra a mensagem do usuário na tela.
  adicionarMensagem("user", mensagem);

  // Limpa o campo de digitação.
  campoMensagem.value = "";

  // Ativa o estado de carregamento.
  definirCarregando(true);

  try {
    // Chama NOSSO backend, e não o Gemini diretamente.
    const respostaHTTP = await fetch("/api/agent", {
      // Usa POST porque estamos enviando dados.
      method: "POST",

      // Informa que o corpo da requisição é JSON.
      headers: {
        "Content-Type": "application/json",
      },

      // Converte o objeto JavaScript em texto JSON.
      body: JSON.stringify({
        // Envia a mensagem atual.
        mensagem,

        // Envia o id desta sessão para separar memórias.
        sessionId,

        // Envia o id da conversa anterior para manter contexto.
        previousInteractionId,
      }),
    });

    // Converte a resposta do servidor de JSON para objeto.
    const dados = await respostaHTTP.json();

    // Se o servidor respondeu com erro HTTP, transforma em exceção.
    if (!respostaHTTP.ok) {
      throw new Error(
        dados.erro || `Erro HTTP ${respostaHTTP.status}`
      );
    }

    // Salva o novo ID para a próxima mensagem continuar o contexto.
    previousInteractionId = dados.interactionId;

    // Mostra a resposta do agente na tela.
    adicionarMensagem("agent", dados.resposta);

    // Atualiza a lista de memórias.
    atualizarMemorias(dados.memorias || []);

    // Mostra quais ferramentas o agente usou.
    toolTexto.textContent =
      dados.ferramentasUsadas?.length
        ? dados.ferramentasUsadas.join(", ")
        : "nenhuma";
  } catch (erro) {
    // Mostra o erro como uma bolha especial.
    adicionarMensagem(
      "error",
      `Erro: ${erro.message}`
    );

    // Atualiza o estado visual.
    statusTexto.textContent = "error";
  } finally {
    // Reativa botão e input independentemente de sucesso ou erro.
    definirCarregando(false);

    // Devolve o foco ao campo de mensagem.
    campoMensagem.focus();
  }
});

// Mostra uma mensagem inicial assim que a página carrega.
adicionarMensagem(
  "agent",
  "Olá! Sou seu primeiro microagente. Teste: diga 'lembre que meu objetivo é aprender React' e depois pergunte 'o que você lembra de mim?'."
);

// Desenha o painel inicial de memória vazio.
atualizarMemorias([]);