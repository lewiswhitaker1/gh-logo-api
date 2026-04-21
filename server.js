const express = require('express');
const cors = require('cors'); // 1. Import cors
const Fuse = require('fuse.js');

const app = express();
const PORT = process.env.PORT || 3000;

// 2. Enable CORS for all routes
// (You can also restrict this to just your Shopify domain later if you want)
app.use(cors());

// Extracted logo data from the provided HTML
const logos = [
    { company: "ADC", url: "https://www.pencarrie.com/storage/phoenix/brands/e6iKTlXTcXCqF3hgLBsA5LvoblUyBvyUIhidkxRK.jpg" },
    { company: "Anthem", url: "https://www.pencarrie.com/storage/phoenix/brands/2uvnvDjUbGneMO0asopLsjSfCuB5uIDi5w3duDkI.jpeg" },
    { company: "AWDis", url: "https://www.pencarrie.com/storage/phoenix/brands/2tonGcZ9LoNqlx5K7NNj8aJFAMyOVPLF5ckXbWD4.jpg" },
    { company: "AWDis Academy", url: "https://www.pencarrie.com/storage/phoenix/brands/ljKkbJlYYLtnZl756TgYGnt2juEk0NUrrrASD0PI.jpeg" },
    { company: "Babybugz", url: "https://www.pencarrie.com/storage/phoenix/brands/un40vaCVBNke9ywAXD6nHGvH3CoawXdLzEeVeNyi.jpg" },
    { company: "BagBase", url: "https://www.pencarrie.com/storage/phoenix/brands/sWx7kj0pkDABXfF7EBnjM1MbyUYUh5B69QHB2Ql2.jpeg" },
    { company: "Beechfield", url: "https://www.pencarrie.com/storage/phoenix/brands/1Ug3X8SGp1veWxsAy1IZ5LVdpmQoC1fT2gcslTbx.jpeg" },
    { company: "Bella+Canvas", url: "https://www.pencarrie.com/storage/phoenix/brands/6ThuRZtYguzXqSuE2ngLDPtLCykKQbIH203hODob.jpeg" },
    { company: "Brand Lab", url: "https://www.pencarrie.com/storage/phoenix/brands/INRJBVzfbtLqrOFGkHawytVCUXpC6Wh7t7OBZ2yy.jpg" },
    { company: "Brook Taverner", url: "https://www.pencarrie.com/storage/phoenix/brands/rxuqWoj0zVLGFafcn2kFVDAD40SF6LR5hAWToBd6.jpg" },
    { company: "Canterbury", url: "https://www.pencarrie.com/storage/phoenix/brands/dTcuunqYdGkzdDAaAWLP8xGPb562lnQUkoRwgubq.jpg" },
    { company: "Comfort Grip", url: "https://www.pencarrie.com/storage/phoenix/brands/CyzgvNQ0nymt9eLvisSLsdas24skHGKSFeUvoaB3.jpeg" },
    { company: "Craghoppers", url: "https://www.pencarrie.com/storage/phoenix/brands/xjcuKxKJ4qqESJgD9j6p8cQzfFWeV77cLOs2sFxZ.jpg" },
    { company: "Dennys", url: "https://www.pencarrie.com/storage/phoenix/brands/fwfyuZcVoThomVzWeVZi2NoZnQp8G191WmZ6KrdE.jpeg" },
    { company: "Ecologie", url: "https://www.pencarrie.com/storage/phoenix/brands/1mTKOmigsosJ5ZMXkfIIwBXmb8qxrQ77xX854in2.jpeg" },
    { company: "Finden & Hales", url: "https://www.pencarrie.com/storage/phoenix/brands/u0bXgPoW9whqojVOQBIjBFW7qlqlPoDo4x33V6xC.jpeg" },
    { company: "Flexfit", url: "https://www.pencarrie.com/storage/phoenix/brands/fBaN2gnlaE0r8vAqTpgIMbSHgL54BW2ABLnyT9ot.jpeg" },
    { company: "Front Row", url: "https://www.pencarrie.com/storage/phoenix/brands/pOtZrk0mS97FRK0ubyRwB0Ia5SROqGUOepI3lwCe.jpg" },
    { company: "Fruit of the Loom", url: "https://www.pencarrie.com/storage/phoenix/brands/rBINAYEDBk5aGdUXwl3QoISCPmg4fjk95xg98az4.jpg" },
    { company: "Gildan", url: "https://www.pencarrie.com/storage/phoenix/brands/Fet72DUN7iJm3xpVj2gcHMF8cxvqdHrea7tKe5Jh.jpeg" },
    { company: "Henbury", url: "https://www.pencarrie.com/storage/phoenix/brands/OnSbLu3Ppn2K8mRfLM03sMFsv21LcJY22Kdlvj0X.jpeg" },
    { company: "Joseph Alan", url: "https://www.pencarrie.com/storage/phoenix/brands/YM7MFVH2j1zYRGJP8S8PIX0q5QqDUBupbK5XdFMN.jpeg" },
    { company: "Just Cool", url: "https://www.pencarrie.com/storage/phoenix/brands/d0BgGBrXku2P4FJTj7P6xz7ElSEzZrtATccrtkBY.jpeg" },
    { company: "Just Hoods", url: "https://www.pencarrie.com/storage/phoenix/brands/ikaGj0mdJI40Ie38QK0ZKIrZtWmtEoZ7iVeYNyCT.jpeg" },
    { company: "Just Polos", url: "https://www.pencarrie.com/storage/phoenix/brands/X9ek5MBS7qwx5tGlcC5H8fL2r942lJmcaVXvPUvh.jpeg" },
    { company: "Just Ts", url: "https://www.pencarrie.com/storage/phoenix/brands/6CYYkWIyW4lWKkIaAoEhc6mkB4Hc3TSx8exrznZZ.jpeg" },
    { company: "K-UP", url: "https://www.pencarrie.com/storage/phoenix/brands/o4lbSfigEf6qydYHSFToCzOcZbDE2zpQ04jYv13A.jpeg" },
    { company: "Kariban", url: "https://www.pencarrie.com/storage/phoenix/brands/2cbL6EDgJQBHa2oS0QTc5Ibcb3GRYFeFiuScIVrW.jpg" },
    { company: "Kimood", url: "https://www.pencarrie.com/storage/phoenix/brands/vWBIqKLQ3jIDLTtKDAQzB1bBm72PJy2SLRcaGxPt.jpg" },
    { company: "Kustom Kit", url: "https://www.pencarrie.com/storage/phoenix/brands/FvZ1wOez9aDllqnlqBAuJv35YqO2sTfbWbmfnSxQ.jpg" },
    { company: "Larkwood", url: "https://www.pencarrie.com/storage/phoenix/brands/LLrbCVvAOcyJpMVMOtvgCGmFcvEFusSS89OdAu4Q.jpeg" },
    { company: "Le Chef", url: "https://www.pencarrie.com/storage/phoenix/brands/6h1BgioZs4uugGbuL97w5e9AZKE6mrvXcqm5su7o.jpeg" },
    { company: "Madeira", url: "https://www.pencarrie.com/storage/phoenix/brands/zPBz2WMKfkY75AJnC8inxNMTMio9haZHLJjAdJyl.jpg" },
    { company: "Magic Touch", url: "https://www.pencarrie.com/storage/phoenix/brands/ZhuuKRMgNu5vsSrTCHWnX27DjSwsw5gXlwf727n3.jpeg" },
    { company: "Mantis", url: "https://www.pencarrie.com/storage/phoenix/brands/vR2A4UiwLd1fRDDTtThFCSD94v1mRbOCE0PnUiA0.jpeg" },
    { company: "Mumbles", url: "https://www.pencarrie.com/storage/phoenix/brands/aI4RVsRUEpEV7zJhfHdFEc7KCPFiXq2e7Ht1rgpt.jpeg" },
    { company: "Native Spirit", url: "https://www.pencarrie.com/storage/phoenix/brands/9M8AKkySxEYPIqZ0qkdSFY4daeyeXMtxbGDslqDl.jpg" },
    { company: "Neoblu", url: "https://www.pencarrie.com/storage/phoenix/brands/ECJX44fYo2dH6vTFTvFT2urey4zOhBeq2W2xJE5G.jpg" },
    { company: "Onna by Premier", url: "https://www.pencarrie.com/storage/phoenix/brands/TmT5q4fTjQv9uOYaQvIGYMM1LPAw9Iy3IbWQYAPL.jpg" },
    { company: "Portwest", url: "https://www.pencarrie.com/storage/phoenix/brands/4VX28BiIvvMjkW2FiJARPLbjX5LeU3ZoJwYXNJda.jpg" },
    { company: "Premier", url: "https://www.pencarrie.com/storage/phoenix/brands/1nubfb0c7zslQ86lV6cmOxjwHqbcLjMXv2HpBw3o.jpeg" },
    { company: "PRO RTX", url: "https://www.pencarrie.com/storage/phoenix/brands/ctvroJyZOU1Ey4HdcO6qIFgfG66rPQKE0QkYoST0.jpeg" },
    { company: "PRO RTX High Vis", url: "https://www.pencarrie.com/storage/phoenix/brands/N9LTAj7wPcJ0E6Ncp8cmblDt2dewwullyBiu8J23.jpeg" },
    { company: "Kariban Proact", url: "https://www.pencarrie.com/storage/phoenix/brands/5jgfVuEsWxa3Kqa75vecVBMVexv6vn70a9k5IqZ4.jpeg" },
    { company: "Quadra", url: "https://www.pencarrie.com/storage/phoenix/brands/yO4Ow4tD8mSBQMkjP9SyXQCcZ6CP1eaaQ7bcpoBT.jpeg" },
    { company: "Ravine", url: "https://www.pencarrie.com/storage/phoenix/brands/P6LaR4fNHm9ZQwQmockHIzwmOkrM2BH7kNw5tkrv.jpg" },
    { company: "Reg. High Vis.", url: "https://www.pencarrie.com/storage/phoenix/brands/xlaHZ8vsV2iCnStt52VF26GBZMIcBUIn1qOaOrGQ.jpeg" },
    { company: "Regatta HM", url: "https://www.pencarrie.com/storage/phoenix/brands/kSF51VPa4ZZMaGZJ07AyQZhfVkDrb79bouSl42Qn.jpeg" },
    { company: "Regatta", url: "https://www.pencarrie.com/storage/phoenix/brands/CGSzCcTDnFVjyQQ5exxkWdYixRYc1GGiguD8zCEh.jpeg" },
    { company: "Reg. Safety F/W", url: "https://www.pencarrie.com/storage/phoenix/brands/kxklny1yvRhzvMvmpvkHJ2GCo75kt9z9AfmKlWMF.jpeg" },
    { company: "Result", url: "https://www.pencarrie.com/storage/phoenix/brands/RBOr6RTWCKH9QMQSMJsUmARbR85UhtZdRmB5Tmfu.jpeg" },
    { company: "Result Core", url: "https://www.pencarrie.com/storage/phoenix/brands/VBLKj6bTK1PRnG7zcLoGGC5DHV1IBT8Da1dru0Wh.jpeg" },
    { company: "Result Ess. Hygiene", url: "https://www.pencarrie.com/storage/phoenix/brands/qovW97WBieII3zgjKOkjLHNlD3N3L7tIKfJ9ncQh.jpeg" },
    { company: "Result Headwear", url: "https://www.pencarrie.com/storage/phoenix/brands/30pmJmwTUTO6A1XNPVPMoA6RKfyRtvv4SEWTk0mZ.jpeg" },
    { company: "Res. Gen. Recycled", url: "https://www.pencarrie.com/storage/phoenix/brands/gOwWKOHgZyf2AUS7SIe9UvaAfwbPtWgDftuPpAiN.jpg" },
    { company: "Result Safe-Guard", url: "https://www.pencarrie.com/storage/phoenix/brands/1GwTAlGvnymHFRCFGv3hXk1INaABawIAY20RaU5d.jpg" },
    { company: "Result Urban", url: "https://www.pencarrie.com/storage/phoenix/brands/kSoNyycXDnbHOBf5O9DFQHQApOnooIPNXK06YRB0.jpeg" },
    { company: "Result Winter Ess.", url: "https://www.pencarrie.com/storage/phoenix/brands/80KvArud26V4Jxc8i0VTcsxE5hdgqv21XZPrkSir.jpeg" },
    { company: "Result Work-Guard", url: "https://www.pencarrie.com/storage/phoenix/brands/K6MIoebUSqEmaU1lcFdWnunJ80NWuKp7xDCKBHqK.jpg" },
    { company: "Russell Athletic", url: "https://www.pencarrie.com/storage/phoenix/brands/VbKvbXYQ3noSwQcuyx0tOm7y56Jpw9uRuqZspuIh.jpg" },
    { company: "Russell Athletic Collection", url: "https://www.pencarrie.com/storage/phoenix/brands/pDGxgxMlqpIwjvS94WY8owSrT4RhyE3IuaEe6iSo.jpg" },
    { company: "SF Clothing", url: "https://www.pencarrie.com/storage/phoenix/brands/y2a7dTEN42JL7eUT5skP8AxHxLxGDTq8FZcH2bjq.jpg" },
    { company: "So Denim", url: "https://www.pencarrie.com/storage/phoenix/brands/ChnJ24NKNvUjsCFkS8X6GmMUMChmE6O1PcsFvZPa.jpeg" },
    { company: "SOLS", url: "https://www.pencarrie.com/storage/phoenix/brands/Epd6rZCLqjK3o4oDDsUNbtiRvHVFbdCRFnHsohYx.jpeg" },
    { company: "Spasso", url: "https://www.pencarrie.com/storage/phoenix/brands/YvFEbLITkfyi9pSfjeF1ndSzJ3a5zzH5eQkguw7F.jpg" },
    { company: "Spiro", url: "https://www.pencarrie.com/storage/phoenix/brands/YUfvUhqHkPPRih8WyxxT1WasSQzYubV0QbHWF2Lu.jpeg" },
    { company: "Splashmac", url: "https://www.pencarrie.com/storage/phoenix/brands/McIpLDo63UWY5JbugPt6KslhSuc2fhFcjbgovr9B.jpeg" },
    { company: "Stormtech", url: "https://www.pencarrie.com/storage/phoenix/brands/OPc0RAEaPqGFir584upppSavbRmZshFQXeNywKU3.jpg" },
    { company: "Supacolour", url: "https://www.pencarrie.com/img/supacolour.png" },
    { company: "Tee Jays", url: "https://www.pencarrie.com/storage/phoenix/brands/MFckIqCODEggtYrKH7Lae0ngNipe4JlXKillAXQy.jpeg" },
    { company: "Tombo", url: "https://www.pencarrie.com/storage/phoenix/brands/0mPtu0TiT9ctJTGVcCQc0BiUUb1ao4PocMwMnJLq.jpeg" },
    { company: "Towel City", url: "https://www.pencarrie.com/storage/phoenix/brands/1JyhNZFY67gHJ4vizDmIkwc7wX7a66xhv4Ek585z.jpeg" },
    { company: "Warrior", url: "https://www.pencarrie.com/storage/phoenix/brands/FCWiuIZIz7mjSG2Y7oO9IAffQKdMuXbD6IE0I8IS.jpeg" },
    { company: "Westford Mill", url: "https://www.pencarrie.com/storage/phoenix/brands/TWKqDfkt7q6qgw5aYbMd3ttUX3YxBB8eEBnBlmLn.jpg" },
    { company: "WK Designed To Work", url: "https://www.pencarrie.com/storage/phoenix/brands/PVx8gxkqrgwr6r1IMhAtLqhjiPN86kNHbGdDUwFK.jpg" },
    { company: "Xpres", url: "https://www.pencarrie.com/storage/phoenix/brands/WRQRCTx9Zk55fs5BF05k8Yp5FItcLgZWORsHEMaD.jpeg" },
    { company: "Yoko", url: "https://www.pencarrie.com/storage/phoenix/brands/oE81VRI18x6E7QjiS4P21aR0tAyf76RAjISfw0fA.jpeg" }
];

// Configure Fuse.js options
const fuseOptions = {
    // isCaseSensitive: false, // Default is false
    includeScore: true,
    // Threshold determines how "fuzzy" the search is. 
    // 0.0 requires a perfect match, 1.0 matches anything. 0.4 is a good sweet spot for typos.
    threshold: 0.4,
    keys: ['company'] // Tell Fuse to search within the 'company' property
};

// Initialize Fuse with your data and options
const fuse = new Fuse(logos, fuseOptions);

// Endpoint to retrieve all logos
app.get('/api/logos', (req, res) => {
    res.json({
        success: true,
        count: logos.length,
        data: logos
    });
});

// Updated fuzzy-search endpoint
app.get('/api/logos/:companyName', (req, res) => {
    const query = req.params.companyName;

    // Perform the fuzzy search
    const results = fuse.search(query);

    // Fuse returns an array of matches ordered by best match first
    if (results.length > 0) {
        // We grab the highest scoring match (index 0) and extract the actual item
        const bestMatch = results[0].item;

        res.json({
            success: true,
            confidenceScore: results[0].score, // Optional: Shows how close the match was (closer to 0 is better)
            data: bestMatch
        });
    } else {
        res.status(404).json({ success: false, message: "Company logo not found" });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});