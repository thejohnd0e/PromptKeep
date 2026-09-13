import { describe, expect, it } from "vitest"
import { parseXmp } from "../../../src/metadata/xmp-reader"
import { serializeXmp } from "../../../src/metadata/xmp-writer"
import { encodeXmp } from "./xmp-test-helpers"

describe("Given a parsed XMP tree", () => {
  it("when serialized then declaration, namespace order, attribute order, empties, and LF are fixed", () => {
    const source = encodeXmp(
      '<x:xmpmeta z:b="2" xmlns:z="urn:z" xmlns:x="adobe:ns:meta/" a="1"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""></rdf:Description></rdf:RDF></x:xmpmeta>',
    )
    const parsed = parseXmp(source)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return

    const output = new TextDecoder().decode(serializeXmp(parsed.value))

    expect(output).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:z="urn:z" a="1" z:b="2"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""/></rdf:RDF></x:xmpmeta>',
    )
  })

  it("when an xpacket wrapper is serialized then its canonical pair surrounds the root", () => {
    const source = encodeXmp(
      `<?xpacket begin='\uFEFF' id='W5M0MpCehiHzreSzNTczkc9d'?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description/></rdf:RDF></x:xmpmeta>\n<?xpacket end='r'?>`,
    )
    const parsed = parseXmp(source)
    expect(parsed.kind).toBe("ok")
    if (parsed.kind !== "ok") return

    const output = new TextDecoder().decode(serializeXmp(parsed.value))

    expect(output).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description/></rdf:RDF></x:xmpmeta>\n<?xpacket end="r"?>`,
    )
  })
})
