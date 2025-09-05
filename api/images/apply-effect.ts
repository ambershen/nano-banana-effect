import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini AI for image generation
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || 'AIzaSyBZCrJUTIziuZJVXRoyoWac5vFkTO-mqDU');
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-image-preview' });

// Available effects for image generation
const EFFECTS = {
  anime_style: {
    name: 'Anime Style',
    description: 'Transform portrait into pretty anime style',
    prompt: 'Using the provided image of this person, transform this portrait into pretty, anime style.'
  },
  picasso_style: {
    name: 'Picasso Style',
    description: 'Transform portrait into Picasso painting style',
    prompt: 'Here\'s your portrait transformed into the style of a Picasso painting.'
  },
  oil_painting: {
    name: 'Oil Painting Style',
    description: 'Transform portrait into Degas oil painting style',
    prompt: 'Here\'s the portrait transformed into the style of a Degas oil painting.'
  },
  frida_effect: {
    name: 'Frida Style',
    description: 'Transform portrait into Frida Kahlo painting style',
    prompt: 'Using the provided image of this person, transform this portrait into Frida Kahlo painting style.'
  },
  miniature_effect: {
    name: 'Miniature Effect',
    description: 'Transform into a collectible figure',
    prompt: 'Create a 1/7 scale commercialized figure of the character in the illustration, in a realistic style and environment. Place the figure on a computer desk, using a circular transparent acrylic base without any text. On the computer screen, display the ZBrush modeling process of the figure. Next to the computer screen, place a BANDAI-style toy packaging box printed with the original artwork.'
  }
};

// In-memory storage for processing jobs (Note: In production, use a database)
interface ProcessingJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  originalImagePath?: string;
  resultImagePath?: string;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
  aiResponse?: string;
}

// Simple in-memory store (in production, use Redis or database)
const processingJobs = new Map<string, ProcessingJob>();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    console.log('Apply effect request body:', req.body);
    console.log('Apply effect request headers:', req.headers);
    
    const { imageId, effectType, intensity = 0.8 } = req.body;
    
    console.log('Extracted values:', { imageId, effectType, intensity });
    
    if (!imageId || !effectType) {
      console.log('Missing required fields - imageId:', imageId, 'effectType:', effectType);
      return res.status(400).json({
        success: false,
        error: 'Missing imageId or effectType'
      });
    }
    
    if (!EFFECTS[effectType as keyof typeof EFFECTS]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid effect type'
      });
    }
    
    // Create processing job
    const jobId = uuidv4();
    const job: ProcessingJob = {
      id: jobId,
      status: 'pending',
      progress: 0,
      createdAt: new Date()
    };
    
    processingJobs.set(jobId, job);
    
    // Start processing asynchronously
    processImageWithAI(jobId, imageId, effectType, intensity).catch(error => {
      console.error('Processing error:', error);
      const job = processingJobs.get(jobId);
      if (job) {
        job.status = 'failed';
        job.error = 'Processing failed';
        processingJobs.set(jobId, job);
      }
    });
    
    res.json({
      success: true,
      jobId,
      estimatedTime: 30 // seconds
    });
  } catch (error) {
    console.error('Apply effect error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start processing'
    });
  }
}

// AI image generation function using Gemini 2.5 Flash Image
async function processImageWithAI(jobId: string, imageId: string, effectType: string, intensity: number) {
  const job = processingJobs.get(jobId);
  if (!job) return;
  
  try {
    // Update job status
    job.status = 'processing';
    job.progress = 10;
    processingJobs.set(jobId, job);
    
    // Find the original image in /tmp directory
    const uploadsDir = '/tmp';
    const files = await fs.readdir(uploadsDir);
    const originalFile = files.find(file => file.startsWith(imageId));
    
    if (!originalFile) {
      throw new Error('Original image not found');
    }
    
    const originalPath = path.join(uploadsDir, originalFile);
    job.originalImagePath = originalPath;
    job.progress = 20;
    processingJobs.set(jobId, job);
    
    // Read and prepare image for Gemini
    const imageBuffer = await fs.readFile(originalPath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = originalFile.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    
    job.progress = 30;
    processingJobs.set(jobId, job);
    
    // Get effect configuration and create intensity-adjusted prompt
    const effect = EFFECTS[effectType as keyof typeof EFFECTS];
    const intensityDescription = intensity > 0.8 ? 'very dramatic and exaggerated' : 
                                intensity > 0.5 ? 'moderate but noticeable' : 'subtle but visible';
    const prompt = `${effect.prompt} Apply this transformation with ${intensityDescription} intensity (${Math.round(intensity * 100)}%). The result should be a ${intensityDescription} transformation that maintains image quality and realism while achieving the desired effect.`;
    
    console.log(`\n=== GEMINI IMAGE GENERATION START ===`);
    console.log(`Job ID: ${jobId}`);
    console.log(`Effect Type: ${effectType}`);
    console.log(`Intensity: ${intensity} (${intensityDescription})`);
    console.log(`Image Size: ${imageBuffer.length} bytes`);
    console.log(`MIME Type: ${mimeType}`);
    console.log(`Prompt: ${prompt}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    job.progress = 40;
    processingJobs.set(jobId, job);
    
    // Send image and prompt to Gemini 2.5 Flash Image for generation
    console.log(`Calling Gemini 2.5 Flash Image API for image generation...`);
    const apiCallStart = Date.now();
    
    const result = await model.generateContent([
      {
        inlineData: {
          data: base64Image,
          mimeType: mimeType
        }
      },
      prompt
    ]);
    
    const apiCallDuration = Date.now() - apiCallStart;
    console.log(`Gemini API call completed in ${apiCallDuration}ms`);
    
    job.progress = 60;
    processingJobs.set(jobId, job);
    
    const response = await result.response;
    
    console.log(`\n=== GEMINI API RESPONSE ===`);
    console.log(`Response candidates: ${response.candidates?.length || 0}`);
    
    // Process the response to extract generated image
    let generatedImageBuffer: Buffer | null = null;
    let hasTextResponse = false;
    
    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          // Check for generated image data
          if (part.inlineData && part.inlineData.data) {
            console.log(`Found generated image data, size: ${part.inlineData.data.length} characters (base64)`);
            generatedImageBuffer = Buffer.from(part.inlineData.data, 'base64');
            console.log(`Decoded image buffer size: ${generatedImageBuffer.length} bytes`);
            break;
          }
          // Check for text response (fallback)
          else if (part.text) {
            console.log(`Found text response: ${part.text.substring(0, 200)}...`);
            hasTextResponse = true;
          }
        }
      }
    }
    
    console.log(`=== GEMINI IMAGE GENERATION END ===\n`);
    
    job.progress = 80;
    processingJobs.set(jobId, job);
    
    let processedBuffer: Buffer;
    
    if (generatedImageBuffer && generatedImageBuffer.length > 0) {
      // Use the AI-generated image
      console.log(`Using AI-generated image (${generatedImageBuffer.length} bytes)`);
      processedBuffer = generatedImageBuffer;
      
      // Optimize the generated image
      try {
        processedBuffer = await sharp(generatedImageBuffer)
          .jpeg({ quality: 90 })
          .toBuffer();
        console.log(`Optimized generated image to ${processedBuffer.length} bytes`);
      } catch (optimizeError) {
        console.log(`Could not optimize generated image, using original: ${optimizeError}`);
        processedBuffer = generatedImageBuffer;
      }
    } else {
      // Fallback: Apply enhanced effects using Sharp if no image was generated
      console.log(`No image generated by AI, applying fallback effects with Sharp`);
      
      switch (effectType) {
        case 'big_head':
          processedBuffer = await sharp(imageBuffer)
            .resize({ width: Math.round(1024 * (1 + intensity * 0.5)), height: Math.round(1024 * (1 + intensity * 0.5)), fit: 'inside' })
            .modulate({ 
              brightness: 1.1 + (intensity * 0.3), 
              saturation: 1.2 + (intensity * 0.4),
              hue: Math.round(intensity * 15)
            })
            .sharpen(1 + intensity * 2)
            .gamma(1.1 + (intensity * 0.3))
            .toBuffer();
          break;
        case 'artistic_style':
          processedBuffer = await sharp(imageBuffer)
            .modulate({ 
              brightness: 1.05 + (intensity * 0.2), 
              saturation: 1.4 + (intensity * 0.5), 
              hue: Math.round(intensity * 20) 
            })
            .blur(0.3 + (intensity * 1.2))
            .sharpen(0.8 + intensity * 1.5)
            .gamma(1.2 + (intensity * 0.4))
            .linear(1.2 + (intensity * 0.3), -(128 * (1.2 + intensity * 0.3)) + 128)
            .toBuffer();
          break;
        case 'aging':
          processedBuffer = await sharp(imageBuffer)
            .modulate({ 
              brightness: 0.9 - (intensity * 0.1), 
              saturation: 0.8 - (intensity * 0.2)
            })
            .gamma(1.3 + (intensity * 0.3))
            .linear(0.9 - (intensity * 0.1), 10 + (intensity * 20))
            .sharpen(0.5 + intensity * 0.5)
            .toBuffer();
          break;
        default:
          processedBuffer = await sharp(imageBuffer)
            .modulate({ brightness: 1.1, saturation: 1.2 })
            .sharpen()
            .toBuffer();
      }
    }
    
    job.progress = 90;
    processingJobs.set(jobId, job);
    
    // Save processed image
    const resultFilename = `generated_${jobId}.jpg`;
    const resultPath = path.join(uploadsDir, resultFilename);
    await fs.writeFile(resultPath, processedBuffer);
    
    // Complete the job
    job.status = 'completed';
    job.progress = 100;
    job.resultImagePath = resultPath;
    job.completedAt = new Date();
    job.aiResponse = generatedImageBuffer ? 'Image generated successfully' : (hasTextResponse ? 'Text response received, applied fallback effects' : 'No response, applied fallback effects');
    processingJobs.set(jobId, job);
    
    console.log(`Image processing completed for job ${jobId} using ${generatedImageBuffer ? 'AI-generated' : 'fallback'} method`);
  } catch (error) {
    console.error('AI image generation error:', error);
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    processingJobs.set(jobId, job);
  }
}

// Export the job storage for other functions to access
export { processingJobs };