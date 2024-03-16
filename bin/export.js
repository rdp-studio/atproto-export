import * as fs from "fs"
import * as path from "path"
import {
    verifyRepoCar,
    getAndParseRecord,
    readCarWithRoot
} from "@atproto/repo"
import { HandleResolver, DidResolver, MemoryCache, getPds } from "@atproto/identity"
import atpApi from "@atproto/api"
import { Command } from "commander"

const { AtpAgent } = atpApi

const program = new Command()
program
    .name("atproto-export")
    .description("Tool to export your ATProto account")
    .argument("<handle-or-did>", "Handle or DID to export")
    .option("-o, --out <out-dir>", "Directory to export to", ".")

program.parse()
const handleOrDid = program.args[0]
const distDir = program.opts().out

const exportRepo = async (repoBytes, did) => {
    const car = await readCarWithRoot(repoBytes)
    const repo = await verifyRepoCar(repoBytes)

    for (const write of repo.creates) {
        const parsed = await getAndParseRecord(car.blocks, write.cid)
        try {
            fs.mkdirSync(distDir)
        } catch { }
        try {
            fs.mkdirSync(path.join(distDir, did))
        } catch { }
        try {
            fs.mkdirSync(path.join(distDir, did, write.collection))
        } catch { }
        fs.writeFileSync(path.join(distDir, did, write.collection, `${write.rkey}.json`), JSON.stringify(parsed.record))
    }
}

const run = async () => {
    const isDid = handleOrDid.startsWith("did:")
    let did = isDid ? handleOrDid : undefined

    if (!isDid) {
        const resolver = new HandleResolver()
        did = await resolver.resolve(handleOrDid)

        if (!did) {
            console.error(`Could not resolve handle: ${handleOrDid}`)
            process.exit(1)
        }
    }

    const safeDid = did.replace("did:plc:", "did-plc-").replace("did:web:", "did-web-")

    const didCache = new MemoryCache()
    const resolver = new DidResolver({
        cache: didCache
    })
    const didDoc = await resolver.resolve(did)

    const pdsUrl = getPds(didDoc)
    if (!pdsUrl) {
        console.error(`Could not resolve PDS for DID: ${did}`)
        process.exit(1)
    }

    const agent = new AtpAgent({
        service: pdsUrl
    })

    console.log("Downloading repo...")
    const repo = await agent.api.com.atproto.sync.getRepo({
        did
    })
    if (!repo.success) {
        console.error(`Could not get repo`)
        process.exit(1)
    }
    const repoBuffer = Buffer.from(repo.data)
    console.log("Exporting repo...")
    await exportRepo(repoBuffer, safeDid)

    console.log("Downloading blobs...")
    try {
        fs.mkdirSync(path.join(distDir, safeDid, "_blobs"))
    } catch { }
    const blobList = await agent.api.com.atproto.sync.listBlobs({
        did,
        limit: 500
    })
    if (!blobList.success) {
        console.error(`Could not get blob list`)
        process.exit(1)
    }
    for (const cidIndex in blobList.data.cids) {
        const cid = blobList.data.cids[cidIndex]
        console.log(`Downloading ${cid} (${parseInt(cidIndex) + 1} / ${blobList.data.cids.length})`)
        const blob = await agent.api.com.atproto.sync.getBlob({
            did,
            cid
        })
        if (!blob.success) {
            console.error(`Could not get blob ${cid}, skipping`)
            continue
        }
        fs.writeFileSync(path.join(distDir, safeDid, "_blobs", cid), blob.data)
    }

    console.log("Done!")
}

run()