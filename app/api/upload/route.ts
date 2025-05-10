import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

// Directory to store uploaded files
const UPLOAD_DIR = join(process.cwd(), 'uploads');

export async function POST(request: NextRequest) {
  try {
    // Ensure the upload directory exists
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true });
    }

    // Get form data from the request
    const formData = await request.formData();
    
    // Get resumable parameters
    const chunkNumber = Number(formData.get('resumableChunkNumber'));
    const totalChunks = Number(formData.get('resumableTotalChunks'));
    const identifier = formData.get('resumableIdentifier') as string;
    const filename = formData.get('resumableFilename') as string;
    const fileChunk = formData.get('file') as File;
    
    if (!fileChunk || !identifier || !filename) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Create a directory for this file's chunks
    const fileDir = join(UPLOAD_DIR, identifier);
    if (!existsSync(fileDir)) {
      await mkdir(fileDir, { recursive: true });
    }

    // Save the chunk
    const chunkPath = join(fileDir, `chunk.${chunkNumber}`);
    const buffer = Buffer.from(await fileChunk.arrayBuffer());
    await writeFile(chunkPath, buffer);

    // Check if all chunks have been uploaded
    if (chunkNumber === totalChunks) {
      // In a real application, you would combine all chunks here
      console.log(`All chunks received for ${filename}. File would be assembled here.`);
      
      // For demonstration purposes, we're just acknowledging receipt
      // In a real app, you would combine chunks and move the file to its final location
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Failed to process upload' },
      { status: 500 }
    );
  }
}

// Handle test requests to check if a chunk exists
export async function GET(request: NextRequest) {
  try {
    // Get query parameters
    const url = new URL(request.url);
    const chunkNumber = url.searchParams.get('resumableChunkNumber');
    const identifier = url.searchParams.get('resumableIdentifier');
    
    if (!chunkNumber || !identifier) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Check if the chunk already exists
    const chunkPath = join(UPLOAD_DIR, identifier, `chunk.${chunkNumber}`);
    
    if (existsSync(chunkPath)) {
      // Chunk exists, return 200 OK
      return new NextResponse(null, { status: 200 });
    } else {
      // Chunk doesn't exist, return 404 Not Found
      return new NextResponse(null, { status: 404 });
    }
  } catch (error) {
    console.error('Test chunk error:', error);
    return NextResponse.json(
      { error: 'Failed to test chunk' },
      { status: 500 }
    );
  }
}