"""Gera o fluxo BPMN 2.0 do Sentinela Sonar em dois formatos:
- docs/sentinela-sonar.bpmn      (abre no bpmn.io / Camunda Modeler)
- docs/sentinela-sonar-bpmn.svg  (imagem para o relatório; converter em PNG com rsvg-convert)
Rodar: python3 docs/gerar-bpmn.py
"""
from pathlib import Path
from xml.sax.saxutils import escape

AQUI = Path(__file__).parent
SZ = {"start": (36, 36), "end": (36, 36), "endError": (36, 36), "task": (130, 80), "send": (130, 80),
      "service": (130, 80), "script": (130, 80), "gw": (50, 50)}

Y0, Y1, Y2, Y3 = 210, 370, 500, 620
# id, tipo, nome, x_centro, y_centro, marcador ('loop' | None)
NOS = [
    ("start", "start", "A cada 1 minuto", 80, Y0, None),
    ("ler", "script", "Ler cadastros (data/cadastros.json)", 200, Y0, None),
    ("gwArq", "gw", "Arquivo legível?", 340, Y0, None),
    ("logArq", "script", "Registrar erro no log", 340, Y1, None),
    ("endArq", "endError", "Execução falha (erro explícito)", 340, Y2, None),
    ("validar", "script", "Validar, remover duplicados e filtrar janela de horário", 480, Y0, "loop"),
    ("gwJanela", "gw", "Há cadastros na janela?", 620, Y0, None),
    ("endVazio", "end", "Ciclo encerrado", 620, Y1, None),
    ("login", "service", "Autenticar na API Olho Vivo (até 3 tentativas)", 760, Y0, None),
    ("gwLogin", "gw", "Login OK?", 900, Y0, None),
    ("falha", "script", "Registrar falha e marcar api_disponivel=false para o MVP", 900, Y1, None),
    ("gwAlerta", "gw", "Admin alertado há < 30 min?", 1050, Y1, None),
    ("endSup", "end", "Fim (alerta suprimido)", 1050, Y2, None),
    ("alerta", "send", "Enviar e-mail de alerta ao administrador", 1180, Y1, None),
    ("endFalha", "end", "Fim (nova tentativa no próximo ciclo)", 1300, Y1, None),
    ("agrupar", "script", "Agrupar cadastros por parada", 1040, Y0, None),
    ("consultar", "service", "Consultar previsão de cada parada (2 tentativas)", 1190, Y0, "loop"),
    ("avaliar", "script", "Para cada cadastro: aplicar regras 1–3 e deduplicação", 1340, Y0, "loop"),
    ("gravar", "script", "Gravar status_mvp.json e log de decisões", 1490, Y0, None),
    ("gwNotif", "gw", "Deve notificar?", 1630, Y0, None),
    ("endSem", "end", "Sem notificação", 1630, Y1, None),
    ("email", "send", "Enviar e-mail ao usuário", 1770, Y0, "loop"),
    ("gwEnvio", "gw", "E-mail enviado?", 1910, Y0, None),
    ("marcar", "script", "Marcar aviso como enviado + log", 2050, Y0, None),
    ("endOk", "end", "Fim do ciclo", 2180, Y0, None),
    ("logEnvio", "script", "Registrar falha de envio (reenvia no próximo ciclo)", 1910, Y1, None),
    ("endEnvio", "end", "Fim do ciclo", 2050, Y1, None),
]
FLUXOS = [
    ("start", "ler", ""), ("ler", "gwArq", ""), ("gwArq", "validar", "sim"), ("gwArq", "logArq", "não"),
    ("logArq", "endArq", ""), ("validar", "gwJanela", ""), ("gwJanela", "login", "sim"),
    ("gwJanela", "endVazio", "não"), ("login", "gwLogin", ""), ("gwLogin", "agrupar", "sim"),
    ("gwLogin", "falha", "não / erro"), ("falha", "gwAlerta", ""), ("gwAlerta", "endSup", "sim"),
    ("gwAlerta", "alerta", "não"), ("alerta", "endFalha", ""), ("agrupar", "consultar", ""),
    ("consultar", "avaliar", ""), ("avaliar", "gravar", ""), ("gravar", "gwNotif", ""),
    ("gwNotif", "email", "sim"), ("gwNotif", "endSem", "não"), ("email", "gwEnvio", ""),
    ("gwEnvio", "marcar", "sim"), ("gwEnvio", "logEnvio", "não"), ("marcar", "endOk", ""),
    ("logEnvio", "endEnvio", ""),
]
NOTA = ("Regras de negócio (por cadastro)\n"
        "R1: ônibus ACESSÍVEL a ≤ limiar → aviso \"está chegando\"\n"
        "      (+ alerta se antes passa um não acessível)\n"
        "R2: próximo ônibus NÃO acessível a ≤ limiar → alerta com\n"
        "      tempo até o próximo acessível\n"
        "R3: nada perto → aguardando (sem envio)\n"
        "Sem repetição: mesmo aviso 1x a cada 90 min;\n"
        "alerta R2 no máx. 1x a cada 15 min por cadastro")
NOTA_POS = (1500, 520, 470, 150)  # x, y, w, h

no = {n[0]: n for n in NOS}


def caixa(nid):
    _, tipo, _, cx, cy, _ = no[nid]
    w, h = SZ[tipo]
    return cx - w / 2, cy - h / 2, w, h


def pontos(a, b):
    ax, ay, aw, ah = caixa(a)
    bx, by, bw, bh = caixa(b)
    acx, acy, bcx, bcy = ax + aw / 2, ay + ah / 2, bx + bw / 2, by + bh / 2
    if abs(acy - bcy) < 1:
        return [(ax + aw, acy), (bx, bcy)]
    if abs(acx - bcx) < 1:
        return [(acx, ay + ah), (bcx, by)]
    return [(acx, ay + ah), (acx, bcy), (bx, bcy)]  # desce e segue para a direita


TAG = {"start": "startEvent", "end": "endEvent", "endError": "endEvent", "task": "task", "send": "sendTask",
       "service": "serviceTask", "script": "scriptTask", "gw": "exclusiveGateway"}


def gerar_bpmn():
    proc, di = [], []
    entradas = {n[0]: [] for n in NOS}
    saidas = {n[0]: [] for n in NOS}
    for i, (a, b, _) in enumerate(FLUXOS):
        saidas[a].append(f"f{i}")
        entradas[b].append(f"f{i}")
    for nid, tipo, nome, *_rest in NOS:
        marcador = _rest[-1]
        filhos = "".join(f"<bpmn:incoming>{f}</bpmn:incoming>" for f in entradas[nid])
        filhos += "".join(f"<bpmn:outgoing>{f}</bpmn:outgoing>" for f in saidas[nid])
        if tipo == "start":
            filhos += '<bpmn:timerEventDefinition><bpmn:timeCycle xsi:type="bpmn:tFormalExpression">R/PT1M</bpmn:timeCycle></bpmn:timerEventDefinition>'
        if tipo == "endError":
            filhos += "<bpmn:errorEventDefinition />"
        if marcador == "loop":
            filhos += '<bpmn:multiInstanceLoopCharacteristics isSequential="true" />'
        proc.append(f'<bpmn:{TAG[tipo]} id="{nid}" name="{escape(nome)}">{filhos}</bpmn:{TAG[tipo]}>')
        x, y, w, h = caixa(nid)
        extra = ' isMarkerVisible="true"' if tipo == "gw" else ""
        di.append(f'<bpmndi:BPMNShape id="{nid}_di" bpmnElement="{nid}"{extra}><dc:Bounds x="{x:.0f}" y="{y:.0f}" width="{w}" height="{h}" /></bpmndi:BPMNShape>')
    for i, (a, b, rot) in enumerate(FLUXOS):
        proc.append(f'<bpmn:sequenceFlow id="f{i}" name="{escape(rot)}" sourceRef="{a}" targetRef="{b}" />')
        wps = "".join(f'<di:waypoint x="{x:.0f}" y="{y:.0f}" />' for x, y in pontos(a, b))
        di.append(f'<bpmndi:BPMNEdge id="f{i}_di" bpmnElement="f{i}">{wps}</bpmndi:BPMNEdge>')
    proc.append(f'<bpmn:textAnnotation id="nota"><bpmn:text>{escape(NOTA)}</bpmn:text></bpmn:textAnnotation>')
    proc.append('<bpmn:association id="assocNota" sourceRef="avaliar" targetRef="nota" />')
    nx, ny, nw, nh = NOTA_POS
    di.append(f'<bpmndi:BPMNShape id="nota_di" bpmnElement="nota"><dc:Bounds x="{nx}" y="{ny}" width="{nw}" height="{nh}" /></bpmndi:BPMNShape>')
    ax, ay, aw, ah = caixa("avaliar")
    di.append(f'<bpmndi:BPMNEdge id="assocNota_di" bpmnElement="assocNota"><di:waypoint x="{ax + aw/2:.0f}" y="{ay + ah:.0f}" /><di:waypoint x="{nx + 60}" y="{ny}" /></bpmndi:BPMNEdge>')

    xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="defs_sentinela" targetNamespace="http://fiap.com.br/gs/sonar">
<bpmn:collaboration id="colab"><bpmn:participant id="pool" name="Robô Sentinela Sonar (n8n)" processRef="sentinela" /></bpmn:collaboration>
<bpmn:process id="sentinela" name="Sentinela Sonar" isExecutable="false">
{chr(10).join(proc)}
</bpmn:process>
<bpmndi:BPMNDiagram id="diag"><bpmndi:BPMNPlane id="plano" bpmnElement="colab">
<bpmndi:BPMNShape id="pool_di" bpmnElement="pool" isHorizontal="true"><dc:Bounds x="-10" y="110" width="2250" height="610" /></bpmndi:BPMNShape>
{chr(10).join(di)}
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>
'''
    (AQUI / "sentinela-sonar.bpmn").write_text(xml, encoding="utf-8")


# ------------------------------------------------------------------ SVG
def quebrar(texto, max_chars):
    linhas, atual = [], ""
    for p in texto.split():
        if len(atual) + len(p) + 1 > max_chars and atual:
            linhas.append(atual)
            atual = p
        else:
            atual = (atual + " " + p).strip()
    return linhas + [atual]


def gerar_svg():
    S = []
    W, H = 2280, 740
    S.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="-20 90 {W} {H - 90}" font-family="Arial, Helvetica, sans-serif">')
    S.append('<defs><marker id="seta" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#333"/></marker></defs>')
    S.append(f'<rect x="-20" y="90" width="{W}" height="{H}" fill="#fff"/>')
    # pool
    S.append('<rect x="-10" y="110" width="2250" height="610" fill="none" stroke="#333" stroke-width="1.5"/>')
    S.append('<rect x="-10" y="110" width="30" height="610" fill="#f2f2f2" stroke="#333" stroke-width="1.5"/>')
    S.append('<text transform="translate(10,415) rotate(-90)" text-anchor="middle" font-size="14" font-weight="bold">Robô Sentinela Sonar (n8n)</text>')
    S.append('<text x="40" y="140" font-size="20" font-weight="bold" fill="#222">Sentinela Sonar — fluxo BPMN da automação (RPA)</text>')

    for i, (a, b, rot) in enumerate(FLUXOS):
        pts = pontos(a, b)
        d = "M" + " L".join(f"{x:.0f},{y:.0f}" for x, y in pts)
        S.append(f'<path d="{d}" fill="none" stroke="#333" stroke-width="1.4" marker-end="url(#seta)"/>')
        if rot:
            (x1, y1), (x2, y2) = pts[0], pts[1]
            if abs(y1 - y2) < 1:
                tx, ty, anc = x1 + 6, y1 - 6, "start"
            else:
                tx, ty, anc = x1 + 6, y1 + 16, "start"
            S.append(f'<text x="{tx:.0f}" y="{ty:.0f}" font-size="12" fill="#555" text-anchor="{anc}">{escape(rot)}</text>')

    for nid, tipo, nome, cx, cy, marcador in NOS:
        x, y, w, h = caixa(nid)
        if tipo in ("start", "end", "endError"):
            larg = 1.6 if tipo == "start" else 4
            S.append(f'<circle cx="{cx}" cy="{cy}" r="18" fill="#fff" stroke="#333" stroke-width="{larg}"/>')
            if tipo == "start":
                S.append(f'<circle cx="{cx}" cy="{cy}" r="12" fill="none" stroke="#333" stroke-width="1.2"/>')
                S.append(f'<path d="M{cx},{cy - 9} L{cx},{cy} L{cx + 6},{cy + 3}" fill="none" stroke="#333" stroke-width="1.4"/>')
            if tipo == "endError":
                S.append(f'<path d="M{cx - 7},{cy + 7} L{cx - 3},{cy - 7} L{cx + 2},{cy + 1} L{cx + 7},{cy - 8} L{cx + 4},{cy + 7} L{cx - 1},{cy - 1} z" fill="#333"/>')
            for j, linha in enumerate(quebrar(nome, 18)):
                S.append(f'<text x="{cx}" y="{cy + 34 + j * 14}" font-size="12" text-anchor="middle" fill="#222">{escape(linha)}</text>')
        elif tipo == "gw":
            S.append(f'<path d="M{cx},{cy - 25} L{cx + 25},{cy} L{cx},{cy + 25} L{cx - 25},{cy} z" fill="#fffbe6" stroke="#333" stroke-width="1.5"/>')
            S.append(f'<path d="M{cx - 8},{cy - 8} L{cx + 8},{cy + 8} M{cx + 8},{cy - 8} L{cx - 8},{cy + 8}" stroke="#333" stroke-width="3"/>')
            for j, linha in enumerate(quebrar(nome, 16)):
                S.append(f'<text x="{cx}" y="{cy - 34 - (len(quebrar(nome, 16)) - 1 - j) * 14}" font-size="12" text-anchor="middle" font-weight="bold" fill="#222">{escape(linha)}</text>')
        else:
            cor = {"send": "#e8f4ff", "service": "#eef7ee", "script": "#f7f7f7"}[tipo]
            S.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{cor}" stroke="#333" stroke-width="1.5"/>')
            if tipo == "send":
                S.append(f'<rect x="{x + 7}" y="{y + 7}" width="18" height="12" fill="#333"/><path d="M{x + 7},{y + 7} L{x + 16},{y + 14} L{x + 25},{y + 7}" stroke="#fff" fill="none"/>')
            if tipo == "service":
                S.append(f'<circle cx="{x + 15}" cy="{y + 14}" r="6" fill="none" stroke="#333" stroke-width="2.5" stroke-dasharray="3,2"/>')
            if tipo == "script":
                S.append(f'<path d="M{x + 9},{y + 6} h12 q-5,6 0,12 h-12 q5,-6 0,-12 z M{x + 11},{y + 10} h7 M{x + 11},{y + 14} h7" fill="none" stroke="#333"/>')
            linhas = quebrar(nome, 18)
            topo = cy - (len(linhas) - 1) * 7 + 4 - (8 if marcador == "loop" else 0)
            for j, linha in enumerate(linhas):
                S.append(f'<text x="{cx}" y="{topo + j * 14:.0f}" font-size="12" text-anchor="middle" fill="#222">{escape(linha)}</text>')
            if marcador == "loop":
                S.append(f'<path d="M{cx - 6},{y + h - 16} v11 M{cx},{y + h - 16} v11 M{cx + 6},{y + h - 16} v11" stroke="#333" stroke-width="2"/>')

    nx, ny, nw, nh = NOTA_POS
    ax, ay, aw, ah = caixa("avaliar")
    S.append(f'<path d="M{ax + aw/2:.0f},{ay + ah:.0f} L{nx + 60},{ny}" stroke="#666" stroke-dasharray="4,3"/>')
    S.append(f'<path d="M{nx + 15},{ny} H{nx} V{ny + nh} H{nx + 15}" fill="none" stroke="#333" stroke-width="1.5"/>')
    S.append(f'<rect x="{nx + 2}" y="{ny}" width="{nw}" height="{nh}" fill="#fffdf0" opacity="0.9"/>')
    for j, linha in enumerate(NOTA.split("\n")):
        peso = ' font-weight="bold"' if j == 0 else ""
        S.append(f'<text x="{nx + 10}" y="{ny + 20 + j * 17}" font-size="12.5"{peso} fill="#222" xml:space="preserve">{escape(linha)}</text>')

    # legenda
    S.append('<text x="40" y="705" font-size="12" fill="#555">Legenda: ◯ evento (início com relógio = timer · fim · fim com raio = erro) · ◇✕ decisão exclusiva · tarefa de script / serviço (API) / envio (e-mail) · ||| = repetição sobre uma coleção</text>')
    S.append('</svg>')
    (AQUI / "sentinela-sonar-bpmn.svg").write_text("\n".join(S), encoding="utf-8")


if __name__ == "__main__":
    gerar_bpmn()
    gerar_svg()
    print("BPMN e SVG gerados em", AQUI)
