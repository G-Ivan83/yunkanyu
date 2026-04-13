import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Settings, ImagePlus, Key, Compass, Sparkles, Moon, Sun } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { GoogleGenAI } from '@google/genai';
import { cn } from './lib/utils';

// --- Types ---
type AppState = 'landing' | 'upload' | 'analyzing' | 'results';

interface AnalysisResult {
  fengShui: string;
  environmental: string;
  suggestions: string;
  imagePrompts?: string[];
  generatedImages: string[];
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
      
      const prompt = `
      作为一位精通传统风水学、环境行为学和人居科学的室内设计大师。
      请分析这张户型图，并提供以下格式的JSON输出（不要包含markdown代码块标记，直接输出纯JSON）：
      {
        "fengShui": "从传统风水学角度的分析（如气口、动静分区、五行方位等），语言要带有古典韵味。",
        "environmental": "从环境行为学和人居科学角度的分析（如动线、采光、空间心理学等）。",
        "suggestions": "具体的室内设计建议（如具体的材质、色彩色号、家具摆放位置等）。必须以具体的要点（1. 2. 3.）形式列出，要求非常具体、可落地，绝不能空泛。",
        "imagePrompts": [
          "3个用于生成设计效果图的英文Prompt。必须严格基于上传户型图中的实际空间结构（如户型图上实际存在的主卧、客厅等）来生成，不要自己编造不存在的空间。描述要详细，包含空间名称、古典/高级美院风格、水墨或工笔画质感、具体的材质和光影等关键词。"
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
        generatedImages
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
          <span className="font-serif text-xl tracking-[0.3em] font-light">人居境象</span>
        </div>
        <div className="flex items-center gap-4">
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
          以AI之眼，洞见空间之气韵，重塑理想居所
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
