import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Settings, ImagePlus, Key, Compass, Sparkles, Moon, Sun, BookOpen, Database, Trash2, FileText, Loader2 } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { GoogleGenAI } from '@google/genai';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import * as mammoth from 'mammoth';
import { cn } from './lib/utils';
import { ARCHITECTURE_KNOWLEDGE } from './knowledge';
import defaultKbData from './data/default_kb.json';

// Polyfill for Promise.withResolvers (required by newer pdfjs-dist)
if (typeof (Promise as any).withResolvers === 'undefined') {
  (Promise as any).withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// --- Types ---
type AppState = 'landing' | 'upload' | 'analyzing' | 'results' | 'report';

interface AnalysisResult {
  fengShui: string;
  environmental: string;
  suggestions: string;
  imagePrompts?: string[];
  generatedImages: string[];
  references?: { source: string; text: string }[];
  citedReferences?: { source: string; text: string }[];
}

interface KBChunk {
  id: string;
  source: string;
  text: string;
  embedding: number[];
}

function chunkText(text: string, chunkSize = 800, overlap = 150) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize - overlap) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

function cosineSimilarity(a: number[], b: number[]) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- Components ---

function StaggeredImageGallery({ images }: { images: string[] }) {
  const [loadedCount, setLoadedCount] = React.useState(0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
      {images.map((imgSrc, idx) => (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.3 + 0.5, duration: 1, ease: [0.25, 0.1, 0.25, 1] }}
          key={idx} 
          className="group relative aspect-[3/4] bg-surface overflow-hidden flex flex-col p-3 shadow-sm border border-primary/10"
        >
          <div className="relative w-full h-full overflow-hidden bg-ink/5">
            {idx <= loadedCount ? (
              <img 
                src={imgSrc} 
                alt={`意境图 ${idx + 1}`} 
                className="w-full h-full object-cover transition-transform duration-[3s] group-hover:scale-105 opacity-90" 
                onLoad={() => setLoadedCount(prev => Math.max(prev, idx + 1))}
                onError={() => setLoadedCount(prev => Math.max(prev, idx + 1))}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-8 h-8 border-[1px] border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-ink/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
          </div>
          
          <div className="absolute bottom-6 right-6 z-30 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-700">
            <div className="flex flex-col items-center gap-2 bg-surface/90 backdrop-blur-sm px-2 py-4">
              <span className="font-serif text-primary text-sm">其{['一','二','三'][idx]}</span>
              <div className="w-[1px] h-6 bg-primary/30" />
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

export default function App() {
  const [appState, setAppState] = useState<AppState>('landing');
  const [apiKey, setApiKey] = useState(import.meta.env.VITE_GEMINI_API_KEY || '');
  const [activationCode, setActivationCode] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showKB, setShowKB] = useState(false);
  const [kbChunks, setKbChunks] = useState<KBChunk[]>(() => {
    try {
      const saved = localStorage.getItem('kbChunks');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.length > 0) return parsed;
      }
      return defaultKbData as KBChunk[];
    } catch {
      return defaultKbData as KBChunk[];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('kbChunks', JSON.stringify(kbChunks));
    } catch (e) {
      console.warn("Failed to save kbChunks to localStorage (might be too large)", e);
    }
  }, [kbChunks]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const handleStart = () => {
    if (!apiKey && !activationCode) {
      setShowSettings(true);
    } else {
      setAppState('upload');
    }
  };

  const handleImageUpload = (file: File) => {
    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const analyzeImage = async () => {
    if (!imageFile || !imagePreview) return;
    
    setAppState('analyzing');
    setError(null);

    try {
      const keyToUse = apiKey || import.meta.env.VITE_GEMINI_API_KEY;
      if (!keyToUse) {
        throw new Error("请赐予灵钥（API Key或激活码）");
      }

      const ai = new GoogleGenAI({ apiKey: keyToUse });
      const base64Data = imagePreview.split(',')[1];
      
      let currentKbChunks = kbChunks;

      // 如果知识库为空，则在首次推演时自动向量化内置典籍
      if (currentKbChunks.length === 0) {
        try {
          const chunks = chunkText(ARCHITECTURE_KNOWLEDGE, 400, 50);
          const newChunks: KBChunk[] = [];
          for (const text of chunks) {
            const response = await ai.models.embedContent({
              model: 'gemini-embedding-2-preview',
              contents: text,
            });
            if (response.embeddings && response.embeddings[0].values) {
              newChunks.push({
                id: Math.random().toString(36).substring(7),
                source: '《八宅明镜》《人居环境科学导论》',
                text: text,
                embedding: response.embeddings[0].values
              });
            }
          }
          setKbChunks(newChunks);
          currentKbChunks = newChunks;
        } catch (e) {
          console.error("Failed to initialize knowledge base", e);
        }
      }
      
      let augmentedContext = "";
      let references: { source: string; text: string }[] = [];
      if (currentKbChunks.length > 0) {
        try {
          const query = "传统风水学、环境行为学、室内设计建议、空间布局、材质色彩";
          const queryResponse = await ai.models.embedContent({
            model: 'gemini-embedding-2-preview',
            contents: query,
          });
          const queryEmbedding = queryResponse.embeddings?.[0]?.values;

          if (queryEmbedding) {
            const similarities = currentKbChunks.map(chunk => ({
              ...chunk,
              similarity: cosineSimilarity(queryEmbedding, chunk.embedding)
            }));

            similarities.sort((a, b) => b.similarity - a.similarity);
            const topChunks = similarities.slice(0, 15);

            augmentedContext = `
            【知识库检索资料 (RAG)】：
            以下是你需要重点参考的学术背景资料（来自开发者预置或用户上传的典籍）：
            ${topChunks.map((c, i) => `资料 ${i+1} (来源: ${c.source}):\n${c.text}`).join('\n\n')}
            
            请在分析时，务必深度借鉴和融合上述资料中的理论和观点，让你的分析更具学术性和专业深度。
            `;
            
            references = topChunks.map(c => ({ source: c.source, text: c.text }));
          }
        } catch (e) {
          console.error("RAG Retrieval failed", e);
        }
      }

      const prompt = `
      作为一位精通传统风水学、环境行为学和人居科学的室内设计大师。
      ${augmentedContext}
      
      【重要指令：严格基于原文】
      1. 在你的分析和建议中，请务必**直接引用**上述提供的【知识库检索资料 (RAG)】中的原文片段来佐证你的观点。
      2. 如果提供的资料中没有直接针对该户型的具体描述，请提取资料中的核心理念（如某种风水原则、环境心理学思想）并将其应用到当前户型中。
      3. **绝不能脱离提供的资料凭空捏造。** 所有的分析都必须能从提供的资料中找到理论支撑。
      4. 引用的格式请使用引号，并在句末标明来源，例如：“[引用的原文]”（《来源》）。
      
      请分析这张户型图，并提供以下格式的JSON输出（不要包含markdown代码块标记，直接输出纯JSON）：
      {
        "fengShui": "从传统风水学角度的分析（如气口、动静分区、五行方位等），语言要带有古典韵味。需包含原文引用。",
        "environmental": "从环境行为学和人居科学角度的分析（如动线、采光、空间心理学等）。需包含原文引用。",
        "suggestions": "具体的室内设计建议（如具体的材质、色彩色号、家具摆放位置等）。必须以具体的要点（1. 2. 3.）形式列出，要求非常具体、可落地，绝不能空泛。需包含原文引用。",
        "imagePrompts": [
          "3个用于生成设计效果图的英文Prompt。必须严格基于上传户型图中的实际空间结构（如户型图上实际存在的主卧、客厅等）来生成，不要自己编造不存在的空间。描述要详细，包含空间名称、古典/高级美院风格、水墨或工笔画质感、具体的材质和光影等关键词。"
        ],
        "citedReferences": [
          {
            "source": "你实际引用的资料来源名称",
            "text": "你实际引用的原文片段（请直接从提供的资料中摘录）"
          }
        ]
      }
      `;

      const textResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: imageFile.type
            }
          },
          prompt
        ],
        config: {
          responseMimeType: "application/json",
        }
      });

      const resultText = textResponse.text;
      if (!resultText) {
        throw new Error("天机难测，文本推演失败。");
      }
      const parsedResult = JSON.parse(resultText) as AnalysisResult;

      const promptsToUse = parsedResult.imagePrompts && parsedResult.imagePrompts.length > 0 
        ? parsedResult.imagePrompts 
        : [
            "A high-quality 3D interior design render of a main living room. Traditional Chinese classical style, elegant wooden furniture, ink wash aesthetic, warm lighting, photorealistic.",
            "A high-quality 3D interior design render of a master bedroom. Traditional Chinese classical style, serene and peaceful, silk textures, soft natural light, photorealistic.",
            "A high-quality 3D interior design render of a study or tea room. Traditional Chinese classical style, Zen atmosphere, bamboo elements, artistic shadows, photorealistic."
          ];

      const generatedImages: string[] = promptsToUse.slice(0, 3).map(imgPrompt => {
        const seed = Math.floor(Math.random() * 1000000);
        return `https://image.pollinations.ai/prompt/${encodeURIComponent(imgPrompt)}?width=800&height=1000&nologo=true&seed=${seed}`;
      });

      setAnalysis({
        ...parsedResult,
        generatedImages,
        references: parsedResult.citedReferences && parsedResult.citedReferences.length > 0 
          ? parsedResult.citedReferences 
          : references
      });
      setAppState('results');

    } catch (err: any) {
      console.error(err);
      setError(err.message || "推演受阻，请检查灵钥或稍后重试。");
      setAppState('upload');
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden flex flex-col bg-paper selection:bg-primary/20 text-ink">
      {/* Header */}
      <header className="absolute top-0 w-full p-8 flex justify-between items-center z-50">
        <div className="flex items-center gap-4 opacity-80 hover:opacity-100 transition-opacity cursor-pointer" onClick={() => setAppState('landing')}>
          <div className="w-1 h-6 bg-primary/60" />
          <span className="font-serif text-xl tracking-[0.3em] font-light">云堪舆</span>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowKB(true)}
            className="p-3 rounded-full hover:bg-primary/10 transition-all text-ink/60 hover:text-ink duration-700"
            title="典籍库 (RAG)"
          >
            <Database className="w-5 h-5" strokeWidth={1} />
          </button>
          <button 
            onClick={() => setAppState('report')}
            className="p-3 rounded-full hover:bg-primary/10 transition-all text-ink/60 hover:text-ink duration-700"
            title="课程作业介绍"
          >
            <BookOpen className="w-5 h-5" strokeWidth={1} />
          </button>
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-3 rounded-full hover:bg-primary/10 transition-all text-ink/60 hover:text-ink duration-700"
          >
            {isDarkMode ? <Sun className="w-5 h-5" strokeWidth={1} /> : <Moon className="w-5 h-5" strokeWidth={1} />}
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-3 rounded-full hover:bg-primary/10 transition-all text-ink/60 hover:text-ink hover:rotate-90 duration-700"
          >
            <Settings className="w-5 h-5" strokeWidth={1} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center p-6 relative z-10 w-full max-w-7xl mx-auto">
        <AnimatePresence mode="wait">
          {appState === 'landing' && (
            <LandingView key="landing" onStart={handleStart} />
          )}
          {appState === 'upload' && (
            <UploadView 
              key="upload" 
              imagePreview={imagePreview}
              onUpload={handleImageUpload}
              onAnalyze={analyzeImage}
              error={error}
            />
          )}
          {appState === 'analyzing' && (
            <AnalyzingView key="analyzing" />
          )}
          {appState === 'results' && analysis && imagePreview && (
            <ResultsView 
              key="results" 
              analysis={analysis} 
              imagePreview={imagePreview}
              onReset={() => {
                setAppState('upload');
                setImageFile(null);
                setImagePreview(null);
                setAnalysis(null);
              }}
            />
          )}
          {appState === 'report' && (
            <ReportView key="report" onBack={() => setAppState('landing')} />
          )}
        </AnimatePresence>
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <SettingsModal 
            apiKey={apiKey}
            setApiKey={setApiKey}
            activationCode={activationCode}
            setActivationCode={setActivationCode}
            onClose={() => setShowSettings(false)}
          />
        )}
        {showKB && (
          <KnowledgeBaseModal 
            apiKey={apiKey}
            kbChunks={kbChunks}
            setKbChunks={setKbChunks}
            onClose={() => setShowKB(false)}
          />
        )}
      </AnimatePresence>
      
      {/* Decorative Elements - Abstract Fine Arts Style */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden opacity-30">
        <motion.div 
          animate={{ 
            scale: [1, 1.05, 1],
            opacity: [0.1, 0.15, 0.1],
            rotate: [0, 5, 0]
          }}
          transition={{ duration: 40, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-[20%] -left-[10%] w-[60vw] h-[60vw] rounded-full bg-secondary ink-wash" 
        />
        <motion.div 
          animate={{ 
            scale: [1, 1.1, 1],
            opacity: [0.05, 0.1, 0.05],
            rotate: [0, -5, 0]
          }}
          transition={{ duration: 50, repeat: Infinity, ease: "easeInOut", delay: 10 }}
          className="absolute -bottom-[10%] -right-[10%] w-[70vw] h-[70vw] rounded-full bg-primary ink-wash" 
        />
      </div>
    </div>
  );
}

// --- Subcomponents ---

const LandingView: React.FC<{ onStart: () => void }> = ({ onStart }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, filter: "blur(5px)" }}
      transition={{ duration: 1.5, ease: [0.25, 0.1, 0.25, 1] }}
      className="flex flex-col md:flex-row items-center justify-center gap-16 md:gap-32 w-full max-w-5xl relative z-10"
    >
      <div className="flex flex-col items-start order-2 md:order-1">
        <motion.p 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 1.5, delay: 0.5 }}
          className="text-lg md:text-xl text-ink/60 mb-16 leading-[2.5] font-light tracking-[0.3em] max-w-md"
        >
          融合环境行为学、传统风水与人居科学<br/>
          以AI之眼，洞见空间气韵，重塑理想居所
        </motion.p>
        
        <motion.button 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.5, delay: 1, ease: [0.25, 0.1, 0.25, 1] }}
          onClick={onStart}
          className="group relative flex items-center gap-6 overflow-hidden bg-transparent text-ink transition-all duration-1000"
        >
          <div className="w-12 h-[1px] bg-primary group-hover:w-24 transition-all duration-1000 ease-[0.25,0.1,0.25,1]" />
          <span className="relative z-10 flex items-center gap-4 tracking-[0.4em] text-sm font-light">
            开启勘境
            <Compass className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity duration-1000" strokeWidth={1} />
          </span>
        </motion.button>
      </div>

      <div className="flex items-start gap-8 order-1 md:order-2">
        <div className="writing-vertical font-serif text-6xl md:text-8xl text-ink tracking-[0.4em] leading-none font-light">
          寻境问室
        </div>
        <motion.div 
          initial={{ height: 0 }}
          animate={{ height: "100%" }}
          transition={{ duration: 2, delay: 0.5, ease: "easeInOut" }}
          className="w-[1px] bg-primary/30"
        />
      </div>
    </motion.div>
  );
};

const UploadView: React.FC<{ 
  imagePreview: string | null, 
  onUpload: (file: File) => void,
  onAnalyze: () => void,
  error: string | null
}> = ({ 
  imagePreview, 
  onUpload, 
  onAnalyze,
  error 
}) => {
  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onUpload(acceptedFiles[0]);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png'] },
    maxFiles: 1
  } as any);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 1.2, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full max-w-4xl flex flex-col items-center"
    >
      <div className="flex flex-col items-center gap-4 mb-16">
        <div className="w-[1px] h-12 bg-primary/30" />
        <h2 className="text-2xl font-serif tracking-[0.4em] text-ink font-light">呈上图卷</h2>
      </div>
      
      <div 
        {...getRootProps()} 
        className={cn(
          "w-full aspect-[4/3] md:aspect-[21/9] flex flex-col items-center justify-center cursor-pointer transition-all duration-1000 overflow-hidden relative group bg-surface shadow-sm",
          isDragActive ? "bg-secondary/10" : "hover:bg-primary/5",
          imagePreview ? "" : "border-[1px] border-primary/20 hover:border-primary/40"
        )}
      >
        <input {...getInputProps()} />
        
        {imagePreview ? (
          <>
            <img src={imagePreview} alt="Floor plan" className="w-full h-full object-contain p-8 opacity-80 transition-transform duration-[3s] group-hover:scale-105" />
            <div className="absolute inset-0 bg-paper/60 opacity-0 group-hover:opacity-100 transition-opacity duration-700 flex items-center justify-center backdrop-blur-sm z-20">
              <p className="text-ink tracking-[0.3em] flex items-center gap-4 text-sm border border-primary/20 px-8 py-3 bg-surface/80">
                <ImagePlus className="w-4 h-4" strokeWidth={1} /> 更换图卷
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center text-ink/40 space-y-8">
            <div className="relative w-16 h-16 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform duration-1000">
              <div className="absolute inset-0 border border-current rotate-45 group-hover:rotate-90 transition-transform duration-1000 opacity-30" />
              <ImagePlus className="w-6 h-6" strokeWidth={1} />
            </div>
            <p className="tracking-[0.3em] text-lg font-light">点击或拖拽上传户型图</p>
            <p className="text-xs opacity-60 tracking-widest font-light">支持 JPG, PNG 格式</p>
          </div>
        )}
      </div>

      {error && (
        <motion.p 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="mt-8 text-primary tracking-widest text-sm"
        >
          {error}
        </motion.p>
      )}

      <AnimatePresence>
        {imagePreview && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 1, delay: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            onClick={(e) => { e.stopPropagation(); onAnalyze(); }}
            className="mt-16 group relative px-16 py-4 overflow-hidden bg-ink text-paper transition-all duration-1000 hover:shadow-lg hover:shadow-ink/10"
          >
            <span className="relative z-10 flex items-center gap-6 tracking-[0.4em] text-sm font-light">
              <Sparkles className="w-4 h-4 opacity-70 group-hover:opacity-100 transition-opacity duration-1000" strokeWidth={1} />
              开始推演
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const AnalyzingView: React.FC = () => {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, filter: "blur(10px)" }}
      transition={{ duration: 1.5 }}
      className="flex flex-col items-center justify-center h-64 relative"
    >
      <div className="relative w-32 h-32 flex items-center justify-center">
        <motion.div 
          animate={{ scale: [1, 1.5, 1], opacity: [0.1, 0.3, 0.1] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 bg-primary rounded-full blur-xl"
        />
        <motion.div 
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.8, 0.3] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
          className="w-2 h-2 bg-primary rounded-full"
        />
      </div>
      <motion.p 
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="mt-12 text-ink tracking-[0.5em] font-light text-lg"
      >
        推演中...
      </motion.p>
      <p className="mt-4 text-ink/40 tracking-widest text-xs font-light">
        观风察水 · 凝练意境
      </p>
    </motion.div>
  );
};

const ResultsView: React.FC<{ 
  analysis: AnalysisResult, 
  imagePreview: string,
  onReset: () => void 
}> = ({ analysis, imagePreview, onReset }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1.5, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full max-w-6xl flex flex-col pb-20"
    >
      {/* Header Actions */}
      <div className="flex justify-between items-center mb-16">
        <button 
          onClick={onReset}
          className="text-ink/50 hover:text-ink transition-colors tracking-widest text-sm flex items-center gap-3 font-light"
        >
          <div className="w-8 h-[1px] bg-current" />
          重置图卷
        </button>
      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
        
        {/* Left Column: Original Image & Vertical Text */}
        <div className="lg:col-span-4 flex flex-col gap-8">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 1.5, ease: [0.25, 0.1, 0.25, 1] }}
            className="relative aspect-square bg-surface p-4 border border-primary/10 shadow-sm"
          >
            <img src={imagePreview} alt="Original Floor Plan" className="w-full h-full object-contain opacity-80" />
            <div className="absolute top-6 left-6 z-20 flex flex-col items-center gap-2 bg-surface/80 backdrop-blur-sm px-2 py-4">
              <span className="font-serif text-sm writing-vertical tracking-widest text-primary">原图</span>
              <div className="w-[1px] h-6 bg-primary/30" />
            </div>
          </motion.div>
          
          <div className="hidden lg:flex flex-col gap-6 items-center justify-center flex-1 border-r border-primary/10 py-8">
             <div className="w-[1px] h-24 bg-gradient-to-b from-transparent via-primary/30 to-transparent" />
             <div className="writing-vertical font-serif text-3xl text-ink/40 tracking-[0.3em] font-light">
               境由心造
             </div>
             <div className="w-[1px] h-24 bg-gradient-to-b from-transparent via-primary/30 to-transparent" />
          </div>
        </div>

        {/* Right Column: Analysis Text */}
        <div className="lg:col-span-8 flex flex-col gap-20">
          
          <motion.section 
            initial={{ opacity: 0, x: 20 }} 
            animate={{ opacity: 1, x: 0 }} 
            transition={{ delay: 0.4, duration: 1.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="relative"
          >
            <div className="absolute -left-8 top-2 text-primary/5 font-serif text-8xl pointer-events-none">风</div>
            <div className="flex items-center gap-6 mb-8">
              <div className="flex flex-col items-center gap-2">
                <span className="font-serif text-primary text-lg">壹</span>
                <div className="w-[1px] h-8 bg-primary/30" />
              </div>
              <h3 className="text-2xl font-serif tracking-[0.3em] text-ink font-light">风水堪舆</h3>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-primary/20 to-transparent" />
            </div>
            <p className="text-base leading-[2.5] text-ink/80 tracking-[0.1em] text-justify font-light whitespace-pre-wrap pl-14">
              {analysis.fengShui}
            </p>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, x: 20 }} 
            animate={{ opacity: 1, x: 0 }} 
            transition={{ delay: 0.6, duration: 1.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="relative"
          >
            <div className="absolute -left-8 top-2 text-primary/5 font-serif text-8xl pointer-events-none">居</div>
            <div className="flex items-center gap-6 mb-8">
              <div className="flex flex-col items-center gap-2">
                <span className="font-serif text-primary text-lg">贰</span>
                <div className="w-[1px] h-8 bg-primary/30" />
              </div>
              <h3 className="text-2xl font-serif tracking-[0.3em] text-ink font-light">人居境理</h3>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-primary/20 to-transparent" />
            </div>
            <p className="text-base leading-[2.5] text-ink/80 tracking-[0.1em] text-justify font-light whitespace-pre-wrap pl-14">
              {analysis.environmental}
            </p>
          </motion.section>

          <motion.section 
            initial={{ opacity: 0, x: 20 }} 
            animate={{ opacity: 1, x: 0 }} 
            transition={{ delay: 0.8, duration: 1.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="relative"
          >
            <div className="absolute -left-8 top-2 text-primary/5 font-serif text-8xl pointer-events-none">造</div>
            <div className="flex items-center gap-6 mb-8">
              <div className="flex flex-col items-center gap-2">
                <span className="font-serif text-primary text-lg">叁</span>
                <div className="w-[1px] h-8 bg-primary/30" />
              </div>
              <h3 className="text-2xl font-serif tracking-[0.3em] text-ink font-light">造境方略</h3>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-primary/20 to-transparent" />
            </div>
            <div className="pl-14">
              <p className="text-base leading-[2.5] text-ink/80 tracking-[0.1em] text-justify font-light whitespace-pre-wrap">
                {analysis.suggestions}
              </p>
            </div>
          </motion.section>

          {analysis.references && analysis.references.length > 0 && (
            <motion.section 
              initial={{ opacity: 0, x: 20 }} 
              animate={{ opacity: 1, x: 0 }} 
              transition={{ delay: 1.0, duration: 1.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="relative mt-12 p-8 border border-primary/20 bg-primary/5"
            >
              <div className="flex items-center gap-4 mb-6">
                <BookOpen className="w-5 h-5 text-primary" strokeWidth={1} />
                <h3 className="text-xl font-serif tracking-[0.3em] text-ink font-light">典籍引据</h3>
              </div>
              <div className="space-y-6">
                {analysis.references.map((ref, idx) => (
                  <div key={idx} className="space-y-2">
                    <div className="text-sm text-primary/80 font-medium tracking-widest">来源：{ref.source}</div>
                    <div className="text-sm text-ink/70 leading-relaxed text-justify font-light border-l border-primary/30 pl-4 py-1">
                      {ref.text}
                    </div>
                  </div>
                ))}
              </div>
            </motion.section>
          )}

        </div>
      </div>

      {/* Image Gallery Section */}
      <motion.section 
        initial={{ opacity: 0, y: 40 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ delay: 1, duration: 1.5, ease: [0.25, 0.1, 0.25, 1] }}
        className="mt-32 pt-20 border-t border-primary/10 relative"
      >
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-paper px-8">
          <div className="flex flex-col items-center gap-4">
            <div className="w-[1px] h-8 bg-primary/30" />
            <span className="font-serif text-lg tracking-widest text-primary font-light">意境参考</span>
            <div className="w-[1px] h-8 bg-primary/30" />
          </div>
        </div>
        
        <div className="mt-12">
          {analysis.generatedImages && analysis.generatedImages.length > 0 ? (
            <StaggeredImageGallery images={analysis.generatedImages} />
          ) : (
            <div className="aspect-[21/9] bg-surface border border-primary/10 flex items-center justify-center">
              <p className="text-ink/40 tracking-widest font-light">未能成功生成意境图，请稍后重试。</p>
            </div>
          )}
        </div>
      </motion.section>

    </motion.div>
  );
};

const SettingsModal: React.FC<{
  apiKey: string;
  setApiKey: (key: string) => void;
  activationCode: string;
  setActivationCode: (code: string) => void;
  onClose: () => void;
}> = ({ apiKey, setApiKey, activationCode, setActivationCode, onClose }) => {
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 bg-paper/90 backdrop-blur-md z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
        className="bg-surface border border-primary/20 p-10 w-full max-w-md shadow-2xl relative"
        onClick={e => e.stopPropagation()}
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        
        <h3 className="text-2xl font-serif tracking-[0.3em] text-ink mb-10 text-center font-light">灵钥设置</h3>
        
        <div className="space-y-8">
          <div>
            <label className="block text-sm text-ink/60 mb-3 tracking-widest font-light">Gemini API Key</label>
            <div className="relative">
              <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" strokeWidth={1} />
              <input 
                type="password" 
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full bg-transparent border border-primary/20 focus:border-primary/60 rounded-none py-3 pl-12 pr-4 text-ink placeholder:text-ink/20 outline-none transition-colors font-light tracking-wider"
                placeholder="输入您的 API Key"
              />
            </div>
          </div>

          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-primary/10"></div>
            <span className="flex-shrink-0 mx-4 text-ink/30 text-xs tracking-widest font-light">或</span>
            <div className="flex-grow border-t border-primary/10"></div>
          </div>

          <div>
            <label className="block text-sm text-ink/60 mb-3 tracking-widest font-light">激活码</label>
            <div className="relative">
              <Sparkles className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" strokeWidth={1} />
              <input 
                type="text" 
                value={activationCode}
                onChange={(e) => setActivationCode(e.target.value)}
                className="w-full bg-transparent border border-primary/20 focus:border-primary/60 rounded-none py-3 pl-12 pr-4 text-ink placeholder:text-ink/20 outline-none transition-colors font-light tracking-wider"
                placeholder="输入激活码"
              />
            </div>
          </div>
        </div>

        <button 
          onClick={onClose}
          className="w-full mt-12 py-4 bg-ink text-paper tracking-[0.4em] text-sm hover:bg-ink/90 transition-colors font-light"
        >
          确认封存
        </button>
      </motion.div>
    </motion.div>
  );
};

const KnowledgeBaseModal: React.FC<{
  apiKey: string;
  kbChunks: KBChunk[];
  setKbChunks: React.Dispatch<React.SetStateAction<KBChunk[]>>;
  onClose: () => void;
}> = ({ apiKey, kbChunks, setKbChunks, onClose }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');

  const uniqueSources = Array.from(new Set(kbChunks.map(c => c.source)));

  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];
    
    const keyToUse = apiKey || import.meta.env.VITE_GEMINI_API_KEY;
    if (!keyToUse) {
      alert("请先在设置中配置 Gemini API Key");
      return;
    }

    setIsProcessing(true);
    try {
      let fullText = '';
      const fileExt = file.name.split('.').pop()?.toLowerCase();

      if (fileExt === 'pdf') {
        setProgressText('正在解析 PDF 文本...');
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ 
          data: new Uint8Array(arrayBuffer),
          standardFontDataUrl: `https://unpkg.com/pdfjs-dist@5.6.205/standard_fonts/`,
        }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map((item: any) => item.str).join(' ');
          fullText += pageText + '\n';
        }
      } else if (fileExt === 'docx' || fileExt === 'doc') {
        setProgressText('正在解析 Word 文本...');
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        fullText = result.value;
      } else {
        throw new Error("不支持的文件格式，仅支持 PDF 和 Word 文档");
      }

      setProgressText('正在进行文本分块...');
      const chunks = chunkText(fullText, 800, 150);

      setProgressText('正在生成向量 (Embeddings)...');
      const ai = new GoogleGenAI({ apiKey: keyToUse });
      const newChunks: KBChunk[] = [];

      for (let i = 0; i < chunks.length; i++) {
        let success = false;
        let retries = 0;
        while (!success && retries < 5) {
          try {
            setProgressText(`正在生成向量... (${i + 1}/${chunks.length})${retries > 0 ? ` [重试 ${retries}/5]` : ''}`);
            const response = await ai.models.embedContent({
              model: 'gemini-embedding-2-preview',
              contents: chunks[i],
            });
            if (response.embeddings && response.embeddings[0].values) {
              newChunks.push({
                id: Math.random().toString(36).substring(7),
                source: file.name,
                text: chunks[i],
                embedding: response.embeddings[0].values
              });
            }
            success = true;
            await new Promise(r => setTimeout(r, 500)); // Rate limit protection
          } catch (e: any) {
            if (e.status === 429 || (e.message && e.message.includes('429'))) {
              retries++;
              await new Promise(r => setTimeout(r, 2000 * retries));
            } else {
              throw e;
            }
          }
        }
        if (!success) {
          throw new Error("API 频率限制或网络错误，部分向量生成失败");
        }
      }

      setKbChunks(prev => [...prev, ...newChunks]);
      setProgressText('');
    } catch (err: any) {
      console.error(err);
      alert("处理文档失败: " + (err.message || err));
    } finally {
      setIsProcessing(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: { 
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc']
    },
    disabled: isProcessing
  } as any);

  const exportKb = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(kbChunks, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "default_kb.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-paper/90 backdrop-blur-md z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="bg-surface border border-primary/20 p-10 w-full max-w-2xl shadow-2xl relative max-h-[80vh] overflow-y-auto custom-scrollbar"
        onClick={e => e.stopPropagation()}
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
        
        <div className="flex justify-between items-center mb-10">
          <h3 className="text-2xl font-serif tracking-[0.3em] text-ink font-light flex items-center gap-4">
            <Database className="w-6 h-6" strokeWidth={1} />
            典籍库 (RAG)
          </h3>
          {kbChunks.length > 0 && (
            <button 
              onClick={exportKb}
              className="px-4 py-2 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors text-sm tracking-widest"
            >
              导出为预计算 JSON
            </button>
          )}
        </div>
        
        <div className="space-y-8">
          <div 
            {...getRootProps()} 
            className={cn(
              "w-full border border-dashed border-primary/30 p-8 flex flex-col items-center justify-center cursor-pointer transition-colors",
              isDragActive ? "bg-primary/10" : "hover:bg-primary/5",
              isProcessing ? "opacity-50 cursor-not-allowed" : ""
            )}
          >
            <input {...getInputProps()} />
            {isProcessing ? (
              <div className="flex flex-col items-center gap-4 text-primary">
                <Loader2 className="w-8 h-8 animate-spin" strokeWidth={1} />
                <p className="tracking-widest text-sm font-light">{progressText}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 text-ink/60">
                <FileText className="w-8 h-8" strokeWidth={1} />
                <p className="tracking-widest text-sm font-light">点击或拖拽上传 PDF / Word 典籍</p>
                <p className="text-xs opacity-60 tracking-widest font-light mt-2">支持 .pdf, .docx, .doc 格式</p>
              </div>
            )}
          </div>

          <div>
            <div className="flex justify-between items-end mb-4">
              <h4 className="text-sm text-ink/60 tracking-widest font-light">已收录典籍 ({uniqueSources.length})</h4>
              {kbChunks.length > 0 && (
                <button 
                  onClick={() => {
                    setKbChunks(prev => prev.filter(c => c.source === '《人居境象·内置典籍》'));
                  }}
                  className="text-xs text-primary/60 hover:text-primary flex items-center gap-1 tracking-widest"
                >
                  <Trash2 className="w-3 h-3" /> 清空用户上传
                </button>
              )}
            </div>
            
            <div className="space-y-2">
              {uniqueSources.length === 0 ? (
                <p className="text-xs text-ink/30 tracking-widest font-light italic">暂无典籍，推演将仅依赖模型基础认知。</p>
              ) : (
                uniqueSources.map((source, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-paper/50 border border-primary/10 text-sm text-ink/80 font-light tracking-wider">
                    <FileText className="w-4 h-4 text-primary/60" strokeWidth={1} />
                    {source}
                    <span className="ml-auto text-xs text-ink/40">
                      {kbChunks.filter(c => c.source === source).length} 卷 (Chunks)
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <button 
          onClick={onClose}
          className="w-full mt-12 py-4 bg-ink text-paper tracking-[0.4em] text-sm hover:bg-ink/90 transition-colors font-light"
        >
          确认封存
        </button>
      </motion.div>
    </motion.div>
  );
};

const ReportView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -40 }}
      transition={{ duration: 1.5, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full max-w-4xl flex flex-col pb-32 pt-16 relative z-10"
    >
      <div className="flex justify-between items-center mb-20">
        <button 
          onClick={onBack}
          className="text-ink/50 hover:text-ink transition-colors tracking-widest text-sm flex items-center gap-3 font-light"
        >
          <div className="w-8 h-[1px] bg-current" />
          返回首页
        </button>
      </div>

      <div className="flex flex-col items-center mb-24">
        <div className="w-[1px] h-16 bg-gradient-to-b from-transparent to-primary/40 mb-8" />
        <h1 className="text-3xl md:text-4xl font-serif tracking-[0.4em] text-ink font-light mb-6 text-center">
          《数字建筑理论与方法》
        </h1>
        <h2 className="text-xl text-ink/60 tracking-[0.3em] font-light text-center">
          课程作业卷宗
        </h2>
        <div className="w-[1px] h-16 bg-gradient-to-t from-transparent to-primary/40 mt-8" />
      </div>

      <div className="space-y-24">
        <section className="relative">
          <div className="absolute -left-8 top-2 text-primary/5 font-serif text-8xl pointer-events-none">壹</div>
          <div className="flex items-center gap-6 mb-10">
            <div className="flex flex-col items-center gap-2">
              <span className="font-serif text-primary text-lg">壹</span>
              <div className="w-[1px] h-8 bg-primary/30" />
            </div>
            <h3 className="text-2xl font-serif tracking-[0.3em] text-ink font-light">检索增强生成 (RAG) 架构</h3>
            <div className="flex-1 h-[1px] bg-gradient-to-r from-primary/20 to-transparent" />
          </div>
          <div className="pl-14 space-y-6 text-ink/80 font-light tracking-wider leading-loose text-justify">
            <p>为了让 AI 的分析更加严谨并具备学术深度，本项目突破了单纯的 Prompt 限制，引入了 <strong className="font-medium text-ink">检索增强生成 (Retrieval-Augmented Generation, RAG)</strong> 技术。</p>
            <ul className="list-disc pl-6 space-y-4">
              <li>
                <strong className="font-medium text-ink">混合知识库构建 (Hybrid Knowledge Base)</strong><br/>
                <span className="opacity-80">系统支持“开发者预置”与“用户自定义上传”双轨并行的知识库。开发者可预置核心理论（如《八宅明镜》《人居环境科学导论》），用户也可在“典籍库”中上传专业的 PDF 文献。前端利用 <code>pdf.js</code> 解析文本，进行分块 (Chunking) 后，调用 Gemini <code>text-embedding-004</code> 模型生成高维向量 (Embeddings) 并持久化存储。</span>
              </li>
              <li>
                <strong className="font-medium text-ink">语义检索与上下文注入</strong><br/>
                <span className="opacity-80">在分析户型图时，系统会将查询意图向量化，通过余弦相似度 (Cosine Similarity) 检索出最相关的 Top-K 典籍片段。这些片段作为上下文注入到 Prompt 中，指导大模型生成具备理论支撑的设计建议，并在生成结果中明确展示“典籍引据”，有效缓解了 AI 的“幻觉”问题。</span>
              </li>
            </ul>
          </div>
        </section>

        <section className="relative">
          <div className="absolute -left-8 top-2 text-primary/5 font-serif text-8xl pointer-events-none">贰</div>
          <div className="flex items-center gap-6 mb-10">
            <div className="flex flex-col items-center gap-2">
              <span className="font-serif text-primary text-lg">贰</span>
              <div className="w-[1px] h-8 bg-primary/30" />
            </div>
            <h3 className="text-2xl font-serif tracking-[0.3em] text-ink font-light">核心 AI 模型</h3>
            <div className="flex-1 h-[1px] bg-gradient-to-r from-primary/20 to-transparent" />
          </div>
          <div className="pl-14 space-y-6 text-ink/80 font-light tracking-wider leading-loose text-justify">
            <p>本项目采用了<strong className="font-medium text-ink">多模型协同 (Multi-Model Orchestration)</strong> 的架构，将视觉理解、文本生成与图像生成分离，以达到最佳效果：</p>
            <ul className="list-disc pl-6 space-y-4">
              <li>
                <strong className="font-medium text-ink">多模态大语言模型：Google Gemini (gemini-3-flash-preview)</strong><br/>
                <span className="opacity-80">利用 Gemini 强大的多模态视觉理解能力，直接读取用户上传的户型图，并结合 RAG 检索到的知识，输出结构化的 JSON 数据。</span>
              </li>
              <li>
                <strong className="font-medium text-ink">AI 图像生成模型：Pollinations.ai</strong><br/>
                <span className="opacity-80">接收 Gemini 动态生成的、带有“传统中式、美院水墨风格、高级质感”等关键词的英文 Prompt，将其转化为高质量的 3D 室内设计概念图。</span>
              </li>
            </ul>
          </div>
        </section>

        <section className="relative">
          <div className="absolute -left-8 top-2 text-primary/5 font-serif text-8xl pointer-events-none">叁</div>
          <div className="flex items-center gap-6 mb-10">
            <div className="flex flex-col items-center gap-2">
              <span className="font-serif text-primary text-lg">叁</span>
              <div className="w-[1px] h-8 bg-primary/30" />
            </div>
            <h3 className="text-2xl font-serif tracking-[0.3em] text-ink font-light">前端技术栈与美学表达</h3>
            <div className="flex-1 h-[1px] bg-gradient-to-r from-primary/20 to-transparent" />
          </div>
          <div className="pl-14 space-y-6 text-ink/80 font-light tracking-wider leading-loose text-justify">
            <p>项目采用现代化的前端技术栈，注重性能、开发体验与交互美感：</p>
            <ul className="list-disc pl-6 space-y-4">
              <li><strong className="font-medium text-ink">核心框架：React 18 + TypeScript + Vite</strong>。利用 React 的组件化思想构建 UI，TypeScript 提供了严格的类型检查。</li>
              <li><strong className="font-medium text-ink">传统东方美学的现代化 UI 表达</strong>。摒弃了传统的卡片式阴影和粗边框，大量使用极细的渐变线条和页面留白。引入了 <code>writing-mode: vertical-rl</code> 实现汉字的竖排显示。</li>
              <li><strong className="font-medium text-ink">质感模拟与动画 (Framer Motion)</strong>。利用 SVG 滤镜在 CSS 中生成了极具质感的“宣纸噪点”纹理，配合模糊和正片叠底，用纯代码模拟出了水墨在纸上晕染的物理视觉效果。</li>
            </ul>
          </div>
        </section>
      </div>
    </motion.div>
  );
};
