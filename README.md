# File Tunnel

A modern file upload client with resumable uploads built with Next.js.

## Features

- **Drag & Drop Interface**: Easy-to-use drag and drop interface for file selection
- **Resumable Uploads**: Uploads are chunked and can be resumed if interrupted
- **Progress Tracking**: Real-time progress tracking for individual files and overall upload
- **Pause & Resume**: Ability to pause and resume uploads
- **Error Handling**: Robust error handling with retry capabilities
- **Responsive Design**: Works well on desktop and mobile devices

## Technology Stack

- **Next.js**: React framework for server-rendered applications
- **TypeScript**: For type safety and better developer experience
- **Tailwind CSS**: For styling and responsive design

## Getting Started

### Prerequisites

- Node.js 18.x or later
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/file-tunnel.git
cd file-tunnel
```

2. Install dependencies:
```bash
npm install
# or
yarn install
```

3. Run the development server:
```bash
npm run dev
# or
yarn dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## How It Works

The file upload system uses a chunked upload approach:

1. Files are split into smaller chunks (default 1MB)
2. Each chunk is uploaded individually
3. The server checks if a chunk already exists before uploading
4. If an upload is interrupted, it can be resumed from the last successful chunk
5. Once all chunks are uploaded, the server reassembles the file

## Configuration

You can configure the uploader by passing props to the `UploadSection` component:

```jsx
<UploadSection 
  targetUrl="/api/upload"
  maxFileSize={1024 * 1024 * 1024} // 1GB
  maxFiles={10}
  allowedFileTypes={['.pdf', '.docx', '.jpg', '.png']}
  chunkSize={1 * 1024 * 1024} // 1MB
  simultaneousUploads={3}
/>
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.
