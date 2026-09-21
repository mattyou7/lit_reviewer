export type NavItem = 'projects' | 'library' | 'landscape' | 'searches' | 'saved' | 'notes' | 'methods' | 'learning' | 'settings';

export interface Paper {
  id: string;
  title: string;
  authors: string[];
  year: number;
  journal: string;
  doi?: string;
  abstract: string;
  tags: string[];
  discoverySource: string;
  citations: number;
  sjrQuartile: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'NA';
  openAccess: boolean;
  saved: boolean;
  similarity?: number;
  arxivId?: string;
  collectionIds: string[];
  fullTextSample: string;
  methods: PaperMethod[];
  references: PaperReference[];
  codeRepos: CodeRepo[];
}

export interface PaperMethod {
  name: string;
  type: 'approach' | 'architecture' | 'algorithm' | 'metric' | 'dataset';
  excerpt: string;
  location: string;
  comparedTo?: string;
  advantage?: string;
}

export interface PaperReference {
  id: string;
  title: string;
  authors: string[];
  year: number;
  journal: string;
  inLibrary: boolean;
  paperId?: string;
}

export interface CodeRepo {
  name: string;
  url: string;
  stars: number;
  language: string;
  relevantFiles: string[];
  description: string;
  pseudoAlgorithm?: string;
}

export interface Collection {
  id: string;
  name: string;
  count: number;
  icon: string;
  parentId: string | null;
  color?: string;
}

export interface GraphNode {
  id: string;
  type: 'paper' | 'concept' | 'method';
  label: string;
  x: number;
  y: number;
  paperId?: string;
  year?: number;
  citations?: number;
  cluster?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'cites' | 'cited-by' | 'semantic' | 'shared-concept' | 'shared-method';
  weight?: number;
}

export interface Note {
  id: string;
  title: string;
  paperId: string | null;
  content: string;
  date: string;
  tags: string[];
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  source: string;
  date: string;
  count: number;
  description: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  paperCount: number;
  noteCount: number;
  lastModified: string;
  color: string;
  status: 'active' | 'archived' | 'draft';
}

export const papers: Paper[] = [
  {
    id: 'p1',
    title: 'Attention Is All You Need',
    authors: ['Vaswani, A.', 'Shazeer, N.', 'Parmar, N.', 'Uszkoreit, J.', 'Jones, L.', 'Gomez, A.N.', 'Kaiser, L.', 'Polosukhin, I.'],
    year: 2017,
    journal: 'Advances in Neural Information Processing Systems',
    doi: '10.48550/arXiv.1706.03762',
    abstract: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train.',
    tags: ['transformers', 'attention', 'NLP', 'sequence transduction', 'encoder-decoder'],
    discoverySource: 'Manual import',
    citations: 89432,
    sjrQuartile: 'Q1',
    openAccess: true,
    saved: true,
    similarity: 1.0,
    arxivId: '1706.03762',
    collectionIds: ['c1', 'c_all'],
    fullTextSample: `The Transformer follows an encoder-decoder structure using stacked self-attention and point-wise, fully connected layers for both the encoder and decoder, shown in the left and right halves of Figure 1, respectively.

**Scaled Dot-Product Attention**

We call our particular attention function "Scaled Dot-Product Attention." The input consists of queries and keys of dimension d_k, and values of dimension d_v. We compute the dot products of the query with all keys, divide each by √d_k, and apply a softmax function to obtain the weights on the values:

    Attention(Q, K, V) = softmax(QK^T / √d_k) V

In practice, we compute the attention function on a set of queries simultaneously, packed together into a matrix Q. The keys and values are also packed together into matrices K and V. We scale the dot products by 1/√d_k to counteract the effect of dot products growing large in magnitude for high-dimensional spaces, which would push the softmax into regions with extremely small gradients.

**Multi-Head Attention**

Instead of performing a single attention function with d_model-dimensional keys, values and queries, we found it beneficial to linearly project the queries, keys and values h times with different, learned linear projections to d_k, d_k and d_v dimensions, respectively.

    MultiHead(Q, K, V) = Concat(head_1, ..., head_h) W^O
    where head_i = Attention(Q W_i^Q, K W_i^K, V W_i^V)

Multi-head attention allows the model to jointly attend to information from different representation subspaces at different positions. With a single attention head, averaging inhibits this.

**Positional Encoding**

Since our model contains no recurrence and no convolution, in order for the model to make use of the order of the sequence, we must inject some information about the relative or absolute position of the tokens in the sequence. We use sine and cosine functions of different frequencies:

    PE(pos, 2i)   = sin(pos / 10000^(2i/d_model))
    PE(pos, 2i+1) = cos(pos / 10000^(2i/d_model))

where pos is the position and i is the dimension. We chose sinusoidal positional encoding because it may allow the model to extrapolate to sequence lengths longer than those encountered during training.

**Results**

On the WMT 2014 English-to-German translation task, the big transformer model outperforms the best previously reported models, including ensembles, by more than 2.0 BLEU, establishing a new state-of-the-art BLEU score of 28.4. The big transformer model achieves 41.0 BLEU on the WMT 2014 English-to-French translation task, outperforming all of the previously published single models, at less than 1/4 the training cost of the previous state-of-the-art model. Training the base model took 0.5 days on 8 P100 GPUs.`,
    methods: [
      {
        name: 'Scaled Dot-Product Attention',
        type: 'algorithm',
        excerpt: 'Attention(Q, K, V) = softmax(QK^T / √d_k) V — scaled to prevent vanishing gradients in high-dimensional spaces.',
        location: 'Section 3.2.1, p. 4',
        comparedTo: 'Additive attention (Bahdanau et al.)',
        advantage: 'Much faster and more space-efficient in practice due to optimized matrix multiplication; comparable in quality at larger d_k.'
      },
      {
        name: 'Multi-Head Attention',
        type: 'architecture',
        excerpt: 'MultiHead(Q, K, V) = Concat(head_1, ..., head_h) W^O, where each head attends to a different linear projection.',
        location: 'Section 3.2.2, p. 4–5',
        comparedTo: 'Single attention head with full d_model dimension',
        advantage: 'Jointly attends to information from different representation subspaces at different positions simultaneously.'
      },
      {
        name: 'Sinusoidal Positional Encoding',
        type: 'approach',
        excerpt: 'PE(pos, 2i) = sin(pos / 10000^(2i/d_model)); PE(pos, 2i+1) = cos(...)',
        location: 'Section 3.5, p. 6',
        comparedTo: 'Learned positional embeddings',
        advantage: 'Allows extrapolation to sequence lengths not seen during training; no additional parameters.'
      },
      {
        name: 'Feed-Forward Networks (FFN)',
        type: 'architecture',
        excerpt: 'FFN(x) = max(0, xW_1 + b_1) W_2 + b_2 — applied identically to each position.',
        location: 'Section 3.3, p. 5',
        comparedTo: 'Recurrent state transitions',
        advantage: 'Fully parallelizable across positions; introduces nonlinearity between attention layers.'
      }
    ],
    references: [
      { id: 'r1', title: 'Neural Machine Translation by Jointly Learning to Align and Translate', authors: ['Bahdanau, D.', 'Cho, K.', 'Bengio, Y.'], year: 2015, journal: 'ICLR 2015', inLibrary: false },
      { id: 'r2', title: 'Sequence to Sequence Learning with Neural Networks', authors: ['Sutskever, I.', 'Vinyals, O.', 'Le, Q.V.'], year: 2014, journal: 'NeurIPS 2014', inLibrary: false },
      { id: 'r3', title: 'Long Short-Term Memory', authors: ['Hochreiter, S.', 'Schmidhuber, J.'], year: 1997, journal: 'Neural Computation', inLibrary: false },
      { id: 'r4', title: 'Dropout: A Simple Way to Prevent Neural Networks from Overfitting', authors: ['Srivastava, N.', 'et al.'], year: 2014, journal: 'JMLR', inLibrary: false },
    ],
    codeRepos: [
      {
        name: 'tensor2tensor',
        url: 'github.com/tensorflow/tensor2tensor',
        stars: 14200,
        language: 'Python',
        relevantFiles: ['tensor2tensor/models/transformer.py', 'tensor2tensor/layers/attention_layers.py', 'tensor2tensor/layers/modalities.py'],
        description: 'Official TensorFlow implementation by the original authors.',
        pseudoAlgorithm: `function ScaledDotProductAttention(Q, K, V, d_k):
    # Q: [batch, heads, seq_q, d_k]
    # K: [batch, heads, seq_k, d_k]
    # V: [batch, heads, seq_k, d_v]
    scores = MatMul(Q, Transpose(K, -2, -1)) / sqrt(d_k)
    if mask is not None:
        scores = scores.masked_fill(mask == 0, -1e9)
    weights = Softmax(scores, dim=-1)
    weights = Dropout(weights, p=0.1)
    return MatMul(weights, V), weights

function MultiHeadAttention(Q, K, V, h, d_model):
    d_k = d_v = d_model // h
    heads = []
    for i in range(h):
        Q_i = Linear(Q, d_model, d_k)
        K_i = Linear(K, d_model, d_k)
        V_i = Linear(V, d_model, d_v)
        head_i, _ = ScaledDotProductAttention(Q_i, K_i, V_i, d_k)
        heads.append(head_i)
    concat = Concat(heads, dim=-1)   # [batch, seq, h * d_v]
    return Linear(concat, h * d_v, d_model)`
      },
      {
        name: 'annotated-transformer',
        url: 'github.com/harvardnlp/annotated-transformer',
        stars: 5800,
        language: 'Python',
        relevantFiles: ['annotated_transformer.py'],
        description: 'Annotated line-by-line PyTorch implementation for learning purposes.'
      }
    ]
  },
  {
    id: 'p2',
    title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    authors: ['Devlin, J.', 'Chang, M.-W.', 'Lee, K.', 'Toutanova, K.'],
    year: 2018,
    journal: 'NAACL-HLT 2019',
    doi: '10.18653/v1/N19-1423',
    abstract: 'We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers. Unlike recent language representation models, BERT is designed to pre-train deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context in all layers. As a result, the pre-trained BERT model can be fine-tuned with just one additional output layer to create state-of-the-art models for a wide range of tasks.',
    tags: ['BERT', 'pre-training', 'NLP', 'bidirectional', 'fine-tuning', 'masked LM'],
    discoverySource: 'Citation traversal from Attention Is All You Need',
    citations: 71238,
    sjrQuartile: 'Q1',
    openAccess: true,
    saved: true,
    similarity: 0.87,
    arxivId: '1810.04805',
    collectionIds: ['c1', 'c2', 'c_all'],
    fullTextSample: `**Pre-training Objectives**

Unlike Peters et al. (2018), and Radford et al. (2018), we do not use traditional left-to-right or right-to-left language models to pre-train BERT. Instead, we pre-train BERT using two unsupervised tasks.

**Task #1: Masked Language Modeling (MLM)**

In order to train a deep bidirectional representation, we simply mask some percentage of the input tokens at random, and then predict those masked tokens. We refer to this procedure as a "masked LM" (MLM). In this case, the final hidden vectors corresponding to the mask tokens are fed into an output softmax over the vocabulary, as in a standard LM. In all of our experiments, we mask 15% of all WordPiece tokens in each sequence at random.

Although this allows us to obtain a bidirectional pre-trained model, a downside is that we are creating a mismatch between pre-training and fine-tuning, since the [MASK] token does not appear during fine-tuning. To mitigate this, we do not always replace "masked" words with the actual [MASK] token. The training data generator chooses 15% of token positions at random. If the i-th token is chosen, we replace the i-th token with: (1) the [MASK] token 80% of the time, (2) a random token 10% of the time, (3) the unchanged i-th token 10% of the time.

**Task #2: Next Sentence Prediction (NSP)**

Many important downstream tasks such as Question Answering (QA) and Natural Language Inference (NLI) are based on understanding the relationship between two sentences, which is not directly captured by language modeling. In order to train a model that understands sentence relationships, we pre-train for a binarized next sentence prediction task.

Specifically, when choosing the sentences A and B for each pre-training example, 50% of the time B is the actual next sentence that follows A (labeled as IsNext), and 50% of the time it is a random sentence from the corpus (labeled as NotNext).

**Model Architecture**

BERT_BASE: L=12, H=768, A=12, Total Parameters=110M
BERT_LARGE: L=24, H=1024, A=16, Total Parameters=340M

where L = number of Transformer layers, H = hidden size, A = number of self-attention heads.`,
    methods: [
      {
        name: 'Masked Language Modeling (MLM)',
        type: 'approach',
        excerpt: 'Mask 15% of WordPiece tokens at random; predict masked tokens from bidirectional context. 80% [MASK], 10% random token, 10% unchanged.',
        location: 'Section 3.1, p. 4',
        comparedTo: 'Left-to-right causal language modeling (GPT-style)',
        advantage: 'Bidirectional context for every token, enabling richer representations for understanding tasks.'
      },
      {
        name: 'Next Sentence Prediction (NSP)',
        type: 'approach',
        excerpt: '50% of the time B follows A in the corpus (IsNext); 50% random sentence from corpus (NotNext). Predict label from [CLS] token.',
        location: 'Section 3.2, p. 4–5',
        comparedTo: 'Single-sentence pre-training objectives',
        advantage: 'Captures inter-sentence relationships directly useful for QA and NLI tasks.'
      },
      {
        name: 'WordPiece Tokenization',
        type: 'approach',
        excerpt: 'Vocabulary of 30,000 WordPiece tokens. Splits rare words into frequent subword units.',
        location: 'Section 4.1, p. 6',
        comparedTo: 'Word-level or character-level tokenization',
        advantage: 'Balances vocabulary size with coverage of rare and unseen words.'
      }
    ],
    references: [
      { id: 'r5', title: 'Attention Is All You Need', authors: ['Vaswani, A.', 'et al.'], year: 2017, journal: 'NeurIPS', inLibrary: true, paperId: 'p1' },
      { id: 'r6', title: 'Deep contextualized word representations (ELMo)', authors: ['Peters, M.E.', 'et al.'], year: 2018, journal: 'NAACL', inLibrary: false },
      { id: 'r7', title: 'Improving Language Understanding by Generative Pre-Training', authors: ['Radford, A.', 'et al.'], year: 2018, journal: 'OpenAI', inLibrary: false },
    ],
    codeRepos: [
      {
        name: 'bert',
        url: 'github.com/google-research/bert',
        stars: 38100,
        language: 'Python',
        relevantFiles: ['modeling.py', 'run_pretraining.py', 'run_classifier.py', 'tokenization.py'],
        description: 'Official Google Research TensorFlow implementation.'
      }
    ]
  },
  {
    id: 'p3',
    title: 'Language Models are Few-Shot Learners',
    authors: ['Brown, T.', 'Mann, B.', 'Ryder, N.', 'Subbiah, M.', 'Kaplan, J.D.', 'Dhariwal, P.', 'Neelakantan, A.'],
    year: 2020,
    journal: 'Advances in Neural Information Processing Systems',
    doi: '10.48550/arXiv.2005.14165',
    abstract: 'We demonstrate that scaling language models greatly improves task-agnostic, few-shot performance, sometimes even reaching competitiveness with prior state-of-the-art fine-tuning approaches. Specifically, we train GPT-3, an autoregressive language model with 175 billion parameters, and test its performance in the few-shot setting. For all tasks, GPT-3 is applied without any gradient updates or fine-tuning, with tasks and few-shot demonstrations specified purely via text interaction with the model.',
    tags: ['GPT-3', 'few-shot learning', 'scaling', 'in-context learning', 'large language models'],
    discoverySource: 'Semantic similarity search',
    citations: 38912,
    sjrQuartile: 'Q1',
    openAccess: true,
    saved: false,
    similarity: 0.79,
    arxivId: '2005.14165',
    collectionIds: ['c2', 'c_all'],
    fullTextSample: `**In-Context Learning**

Recent work has demonstrated substantial gains on many NLP tasks and benchmarks by pre-training on a large corpus of text followed by fine-tuning on task-specific data. We show that scaling up language models greatly improves task-agnostic, few-shot performance.

We use the term "few-shot learning" to refer to the setting where the model is given only a few demonstrations of the task at inference time as conditioning. The model is evaluated on a new task by providing K examples of the task as context, where K typically ranges from 10 to 100 examples. No gradient updates are performed.

    Zero-shot: Only a task description is provided.
    One-shot: The task description and a single example are provided.
    Few-shot: The task description and K examples are provided.

**Architecture**

GPT-3 uses the same model and architecture as GPT-2, with the exception of alternating dense and locally banded sparse attention patterns in the layers of the transformer, similar to the Sparse Transformer. The model has 175 billion parameters:
- 96 Transformer layers
- 96 attention heads per layer
- 12,288-dimensional embeddings
- Context window of 2,048 tokens

**Training Data**

The training data is a filtered version of Common Crawl (570 GB) plus WebText2 (19 GB), Books1 (12 GB), Books2 (55 GB), and Wikipedia (3 GB). Total: approximately 300 billion tokens.

The Common Crawl data was filtered using a trained classifier to predict whether a document would be referenced on Reddit with at least 3 karma. This fuzzy deduplication significantly improves perplexity.

**Results on SuperGLUE**

GPT-3 few-shot achieves 71.8 on SuperGLUE, compared to 69.0 for the few-shot human baseline and 89.0 for fine-tuned T5+. On the Winogrande dataset, GPT-3 achieves 88.6% in one-shot and 88.3% few-shot, surpassing the 88.0% achieved by fine-tuned BERT.`,
    methods: [
      {
        name: 'In-Context Few-Shot Learning',
        type: 'approach',
        excerpt: 'K (input, output) demonstrations are prepended to the query at inference time as plain text. No gradient updates performed.',
        location: 'Section 2.1, p. 6',
        comparedTo: 'Task-specific fine-tuning',
        advantage: 'Single model serves many tasks without task-specific parameters; flexible task specification via natural language.'
      },
      {
        name: 'Sparse Attention (Alternating)',
        type: 'architecture',
        excerpt: 'Alternating dense and locally banded sparse attention patterns across transformer layers.',
        location: 'Section 2.1, p. 8',
        comparedTo: 'Full dense attention in all layers',
        advantage: 'Reduces memory and compute to scale to 175B parameters with longer context windows.'
      }
    ],
    references: [
      { id: 'r8', title: 'Attention Is All You Need', authors: ['Vaswani, A.', 'et al.'], year: 2017, journal: 'NeurIPS', inLibrary: true, paperId: 'p1' },
      { id: 'r9', title: 'Scaling Laws for Neural Language Models', authors: ['Kaplan, J.', 'et al.'], year: 2020, journal: 'arXiv', inLibrary: false },
    ],
    codeRepos: []
  },
  {
    id: 'p4',
    title: 'An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale',
    authors: ['Dosovitskiy, A.', 'Beyer, L.', 'Kolesnikov, A.', 'Weissenborn, D.', 'Zhai, X.', 'Unterthiner, T.'],
    year: 2020,
    journal: 'International Conference on Learning Representations',
    doi: '10.48550/arXiv.2010.11929',
    abstract: 'When pre-trained on large amounts of data and transferred to multiple mid-sized or small image recognition benchmarks, Vision Transformer (ViT) attains excellent results compared to state-of-the-art convolutional networks while requiring substantially fewer computational resources to train. Reliance on CNNs is not necessary and a pure transformer applied directly to sequences of image patches can perform very well on image classification.',
    tags: ['ViT', 'vision transformer', 'image recognition', 'patch embedding', 'transfer learning'],
    discoverySource: 'Citation traversal from Attention Is All You Need',
    citations: 31204,
    sjrQuartile: 'Q1',
    openAccess: true,
    saved: true,
    similarity: 0.74,
    arxivId: '2010.11929',
    collectionIds: ['c1', 'c_all'],
    fullTextSample: `**Model Overview**

In the Vision Transformer (ViT), we split an image into fixed-size patches, linearly embed each patch, add position embeddings, and feed the resulting sequence of vectors to a standard Transformer encoder. In order to perform classification, we use the standard approach of adding an extra learnable "classification token" to the sequence.

**Patch Embeddings**

The standard Transformer receives as input a 1D sequence of token embeddings. To handle 2D images, we reshape the image x ∈ R^(H×W×C) into a sequence of flattened 2D patches x_p ∈ R^(N × (P²·C)), where (H, W) is the resolution of the original image, C is the number of channels, (P, P) is the resolution of each image patch, and N = HW/P² is the resulting number of patches, which also serves as the effective input sequence length for the Transformer.

A trainable linear projection maps each vectorized patch to the model dimension D:

    z_0 = [x_class; x_p^1 E; x_p^2 E; ...; x_p^N E] + E_pos

where E ∈ R^((P²·C)×D) is the patch embedding projection, E_pos ∈ R^((N+1)×D) is the position embedding, and x_class is a learnable embedding whose state at the Transformer's output serves as the image representation.

**Model Variants**

ViT-Base/16: 12 layers, 768-d, 12 heads, 16×16 patches, 86M params
ViT-Large/16: 24 layers, 1024-d, 16 heads, 16×16 patches, 307M params
ViT-Huge/14: 32 layers, 1280-d, 16 heads, 14×14 patches, 632M params

**Key Finding**

ViT trained on ImageNet-21k (14M images) and fine-tuned on ImageNet achieves 87.76% top-1 accuracy with ViT-L/16. When trained on JFT (303M images), ViT-H/14 achieves 88.55%.

The authors note that ViT is less efficient than ResNets on smaller datasets but becomes increasingly competitive with more data, suggesting transformers are data-hungry but highly scalable.`,
    methods: [
      {
        name: 'Patch Embedding',
        type: 'approach',
        excerpt: 'Image is reshaped into N non-overlapping patches of size P×P, each flattened and projected to dimension D via a learned linear layer.',
        location: 'Section 3.1, p. 3',
        comparedTo: 'CNN feature map extraction',
        advantage: 'Allows standard Transformer with minimal architectural modification; captures global context from the first layer.'
      },
      {
        name: 'Class Token Classification',
        type: 'architecture',
        excerpt: 'A learnable [class] token is prepended to the patch sequence. Its state after the final layer serves as the image representation for classification.',
        location: 'Section 3.1, p. 3',
        comparedTo: 'Global average pooling over all patches',
        advantage: 'Following BERT, decouples classification from spatial patch representations.'
      }
    ],
    references: [
      { id: 'r10', title: 'Attention Is All You Need', authors: ['Vaswani, A.', 'et al.'], year: 2017, journal: 'NeurIPS', inLibrary: true, paperId: 'p1' },
      { id: 'r11', title: 'BERT: Pre-training of Deep Bidirectional Transformers', authors: ['Devlin, J.', 'et al.'], year: 2018, journal: 'NAACL', inLibrary: true, paperId: 'p2' },
    ],
    codeRepos: [
      {
        name: 'vision_transformer',
        url: 'github.com/google-research/vision_transformer',
        stars: 9400,
        language: 'Python/JAX',
        relevantFiles: ['vit_jax/models.py', 'vit_jax/input_pipeline.py', 'vit_jax/checkpoint.py'],
        description: 'Official JAX/Flax implementation from Google Research.'
      }
    ]
  },
  {
    id: 'p5',
    title: 'Denoising Diffusion Probabilistic Models',
    authors: ['Ho, J.', 'Jain, A.', 'Abbeel, P.'],
    year: 2020,
    journal: 'Advances in Neural Information Processing Systems',
    doi: '10.48550/arXiv.2006.11239',
    abstract: 'We present high quality image synthesis results using diffusion probabilistic models, a class of latent variable models inspired by considerations from nonequilibrium thermodynamics. Our best results are obtained by training on a weighted variational bound designed according to a novel connection between diffusion probabilistic models and denoising score matching with Langevin dynamics.',
    tags: ['diffusion models', 'generative models', 'image synthesis', 'score matching', 'DDPM'],
    discoverySource: 'PubMed search: "diffusion generative image synthesis"',
    citations: 19873,
    sjrQuartile: 'Q1',
    openAccess: true,
    saved: false,
    similarity: 0.52,
    arxivId: '2006.11239',
    collectionIds: ['c3', 'c_all'],
    fullTextSample: `**Diffusion Process**

A diffusion probabilistic model is a parameterized Markov chain trained using variational inference to produce samples matching the data distribution. Transitions of this chain are learned to reverse a diffusion process, which is a Markov chain that gradually adds noise to the data in the opposite direction of sampling until signal is destroyed.

The forward process q adds Gaussian noise at each step t according to a variance schedule β_1, ..., β_T:

    q(x_t | x_{t-1}) = N(x_t; √(1-β_t) x_{t-1}, β_t I)

A key property is that sampling x_t at any arbitrary timestep t is available in closed form using the notation α_t = 1 - β_t and ᾱ_t = ∏_{s=1}^{t} α_s:

    q(x_t | x_0) = N(x_t; √ᾱ_t x_0, (1 - ᾱ_t) I)

**Reverse Process**

The reverse process is a Markov chain with learned Gaussian transitions p_θ:

    p_θ(x_{t-1} | x_t) = N(x_{t-1}; μ_θ(x_t, t), Σ_θ(x_t, t))

In practice, we predict the noise ε that was added using a neural network ε_θ(x_t, t), and recover x_{t-1} via:

    μ_θ(x_t, t) = (1/√α_t)(x_t - β_t / √(1 - ᾱ_t) · ε_θ(x_t, t))

**Training Objective**

Rather than optimizing the full variational lower bound, the authors find the simplified objective empirically superior:

    L_simple = E_{t, x_0, ε} [||ε - ε_θ(√ᾱ_t x_0 + √(1-ᾱ_t)ε, t)||²]

This is equivalent to a reweighted denoising score matching objective. The model architecture is a U-Net with group normalization, self-attention at 16×16 and 8×8 resolutions, and time-step embedding via sinusoidal positional encodings.`,
    methods: [
      {
        name: 'Denoising Score Matching Objective',
        type: 'algorithm',
        excerpt: 'L_simple = E[||ε - ε_θ(√ᾱ_t x_0 + √(1-ᾱ_t)ε, t)||²] — train noise predictor directly.',
        location: 'Section 3.3, p. 4–5',
        comparedTo: 'Full variational lower bound ELBO',
        advantage: 'Simplified training objective that is empirically superior; equivalent to downweighted denoising score matching.'
      },
      {
        name: 'Linear Noise Schedule',
        type: 'approach',
        excerpt: 'β_t increases linearly from β_1 = 10^{-4} to β_T = 0.02 over T = 1000 steps.',
        location: 'Section 4, p. 6',
        comparedTo: 'Cosine or learned schedules',
        advantage: 'Simple fixed schedule; later work (IDDPM) showed cosine schedules to be superior for some resolutions.'
      }
    ],
    references: [
      { id: 'r12', title: 'Deep Unsupervised Learning using Nonequilibrium Thermodynamics', authors: ['Sohl-Dickstein, J.', 'et al.'], year: 2015, journal: 'ICML', inLibrary: false },
      { id: 'r13', title: 'Generative Adversarial Nets', authors: ['Goodfellow, I.', 'et al.'], year: 2014, journal: 'NeurIPS', inLibrary: false },
    ],
    codeRepos: [
      {
        name: 'denoising-diffusion-pytorch',
        url: 'github.com/lucidrains/denoising-diffusion-pytorch',
        stars: 12700,
        language: 'Python',
        relevantFiles: ['denoising_diffusion_pytorch/denoising_diffusion_pytorch.py', 'denoising_diffusion_pytorch/attend.py'],
        description: 'Popular PyTorch implementation with improvements over original code.'
      }
    ]
  },
  {
    id: 'p6',
    title: 'Learning Transferable Visual Models From Natural Language Supervision',
    authors: ['Radford, A.', 'Kim, J.W.', 'Hallacy, C.', 'Ramesh, A.', 'Goh, G.', 'Agarwal, S.'],
    year: 2021,
    journal: 'International Conference on Machine Learning',
    doi: '10.48550/arXiv.2103.00020',
    abstract: 'We demonstrate that the simple pre-training task of predicting which caption goes with which image is an efficient and scalable way to learn SOTA image representations from scratch on a dataset of 400 million (image, text) pairs. After pre-training, natural language is used to reference learned visual concepts (or describe new ones) enabling zero-shot transfer of the model to downstream tasks.',
    tags: ['CLIP', 'contrastive learning', 'vision-language', 'zero-shot transfer', 'multimodal'],
    discoverySource: 'Semantic similarity to ViT',
    citations: 25871,
    sjrQuartile: 'Q1',
    openAccess: true,
    saved: true,
    similarity: 0.68,
    arxivId: '2103.00020',
    collectionIds: ['c_all'],
    fullTextSample: `**Contrastive Pre-Training**

Given a batch of N (image, text) pairs, CLIP is trained to predict which of the N×N possible (image, text) pairings actually occurred. This is done by jointly training an image encoder and a text encoder to maximize the cosine similarity of the N real pairs and minimize the cosine similarity of the N²-N incorrect pairings in the batch.

The symmetric cross-entropy loss over similarity scores is:

    L = -1/(2N) [Σ_i log exp(s_{i,i}/τ) / Σ_j exp(s_{i,j}/τ)
                + Σ_i log exp(s_{i,i}/τ) / Σ_j exp(s_{j,i}/τ)]

where s_{i,j} = cos(v_i, t_j), v_i is the L2-normalized image embedding, t_j is the L2-normalized text embedding, and τ is a learned temperature parameter initialized to 0.07.

**Architecture**

Image encoders evaluated:
- ResNet family: ResNet-50, ResNet-101, RN50×4, RN50×16, RN50×64
- ViT family: ViT-B/32, ViT-B/16, ViT-L/14, ViT-L/14@336px

Text encoder: Transformer with 63M parameters, 12 layers, 512-wide, 8 attention heads, masked self-attention, max sequence length 76.

Training data: 400 million (image, text) pairs collected from the internet (WIT — WebImageText).

**Zero-Shot Transfer**

For zero-shot classification on a dataset with N classes, we create N text prompts of the form "A photo of a {class_name}" and embed them all. For a new image, we find the text embedding with highest cosine similarity:

    p(y=k|x) = exp(cos(v, t_k)/τ) / Σ_j exp(cos(v, t_j)/τ)

On ImageNet, ViT-L/14 CLIP achieves 76.2% zero-shot top-1 accuracy, matching the 76.1% of a supervised ResNet-50 without any ImageNet training.`,
    methods: [
      {
        name: 'Contrastive Image-Text Pre-Training',
        type: 'approach',
        excerpt: 'Symmetric cross-entropy loss over cosine similarity scores for N real pairs in a batch of N × N possible pairings.',
        location: 'Section 2.1, p. 3',
        comparedTo: 'Predictive image captioning objectives',
        advantage: 'Simple, scalable; no class labels needed; learned features transfer zero-shot to downstream tasks.'
      },
      {
        name: 'Prompt Engineering for Zero-Shot',
        type: 'approach',
        excerpt: '"A photo of a {label}." or "A photo of a {label}, a type of {category}." — contextual prompts outperform bare class names by 3.5% on ImageNet.',
        location: 'Section 3.1.3, p. 6',
        comparedTo: 'Bare class name text queries',
        advantage: 'Reduces polysemy and distribution mismatch between internet captions and benchmark class names.'
      }
    ],
    references: [
      { id: 'r14', title: 'An Image is Worth 16x16 Words', authors: ['Dosovitskiy, A.', 'et al.'], year: 2020, journal: 'ICLR', inLibrary: true, paperId: 'p4' },
    ],
    codeRepos: [
      {
        name: 'CLIP',
        url: 'github.com/openai/CLIP',
        stars: 24600,
        language: 'Python',
        relevantFiles: ['clip/model.py', 'clip/clip.py', 'clip/simple_tokenizer.py'],
        description: 'Official OpenAI implementation in PyTorch.'
      }
    ]
  },
  {
    id: 'p7',
    title: 'Training language models to follow instructions with human feedback',
    authors: ['Ouyang, L.', 'Wu, J.', 'Jiang, X.', 'Almeida, D.', 'Wainwright, C.L.', 'Mishkin, P.'],
    year: 2022,
    journal: 'Advances in Neural Information Processing Systems',
    doi: '10.48550/arXiv.2203.02155',
    abstract: 'Making language models bigger does not inherently make them better at following a user\'s intent. Large models can generate outputs that are untruthful, toxic, or simply not helpful to the user. We show an avenue for aligning language models with user intent on a wide range of tasks by fine-tuning with human feedback, resulting in InstructGPT.',
    tags: ['RLHF', 'alignment', 'instruction following', 'human feedback', 'InstructGPT', 'PPO'],
    discoverySource: 'Citation traversal from GPT-3',
    citations: 14932,
    sjrQuartile: 'Q1',
    openAccess: true,
    saved: true,
    similarity: 0.71,
    arxivId: '2203.02155',
    collectionIds: ['c4', 'c_all'],
    fullTextSample: `**Three-Step RLHF Procedure**

We train InstructGPT models in three steps:

**Step 1: Supervised Fine-Tuning (SFT)**
We fine-tune GPT-3 on a dataset of labeler-written demonstrations. Labelers are given a distribution of prompts from the OpenAI API and write ideal responses. The model is fine-tuned using supervised learning on this dataset for 16 epochs, using cosine learning rate decay.

**Step 2: Reward Model (RM) Training**
For each prompt, the SFT model generates multiple outputs. Human labelers rank these outputs. We train a reward model to assign a scalar reward to a (prompt, output) pair, by training on all pairs from the ranking:

    L_RM = -E_{(x,y_w,y_l)} [log σ(r_θ(x, y_w) - r_θ(x, y_l))]

where y_w is the preferred output and y_l is the less preferred output.

**Step 3: Reinforcement Learning (PPO) Optimization**
The SFT model is further fine-tuned using PPO to maximize the reward:

    objective(φ) = E_{(x,y)~π_φ^RL} [r_θ(x,y)] - β·KL[π_φ^RL(y|x) || π^SFT(y|x)] + γ·E_{x~D_pretrain} [log(π_φ^RL(x))]

The KL penalty term (β·KL[...]) prevents the RL policy from deviating too far from the SFT model, mitigating reward hacking. β = 0.01–0.1 in practice. The pretraining gradient (γ·E[...]) prevents performance regression on general NLP benchmarks.

**Key Result**

A 1.3B InstructGPT model is preferred over the 175B GPT-3 in 85±3% of comparisons, despite having 100× fewer parameters, demonstrating that alignment quality is more important than raw scale for instruction-following.`,
    methods: [
      {
        name: 'Reinforcement Learning from Human Feedback (RLHF)',
        type: 'approach',
        excerpt: 'PPO optimization with KL-divergence penalty from SFT policy and pretraining gradient term. Three-step: SFT → RM → PPO.',
        location: 'Section 3, p. 5–7',
        comparedTo: 'Supervised fine-tuning alone on demonstrations',
        advantage: 'Human preferences guide behavior beyond what static demonstrations can capture; reduces toxicity and increases helpfulness.'
      },
      {
        name: 'Bradley-Terry Reward Model',
        type: 'algorithm',
        excerpt: 'L_RM = -E [log σ(r_θ(x, y_w) - r_θ(x, y_l))] — pairwise ranking loss on human preference labels.',
        location: 'Section 3.2, p. 6',
        comparedTo: 'Absolute rating annotation',
        advantage: 'Pairwise ranking is more consistent across annotators than absolute quality scores.'
      }
    ],
    references: [
      { id: 'r15', title: 'Language Models are Few-Shot Learners', authors: ['Brown, T.', 'et al.'], year: 2020, journal: 'NeurIPS', inLibrary: true, paperId: 'p3' },
      { id: 'r16', title: 'Proximal Policy Optimization Algorithms', authors: ['Schulman, J.', 'et al.'], year: 2017, journal: 'arXiv', inLibrary: false },
    ],
    codeRepos: []
  },
  {
    id: 'p8',
    title: 'Chain-of-Thought Prompting Elicits Reasoning in Large Language Models',
    authors: ['Wei, J.', 'Wang, X.', 'Schuurmans, D.', 'Bosma, M.', 'Ichter, B.', 'Xia, F.', 'Chi, E.'],
    year: 2022,
    journal: 'Advances in Neural Information Processing Systems',
    doi: '10.48550/arXiv.2201.11903',
    abstract: 'We explore how generating a chain of thought — a series of intermediate reasoning steps — significantly improves the ability of large language models to perform complex reasoning. A striking empirical finding is that chain-of-thought reasoning is an emergent ability of model scale, only occurring reliably above approximately 100 billion parameters.',
    tags: ['chain-of-thought', 'reasoning', 'prompting', 'emergent abilities', 'arithmetic reasoning'],
    discoverySource: 'Semantic similarity to GPT-3',
    citations: 10843,
    sjrQuartile: 'Q1',
    openAccess: true,
    saved: false,
    similarity: 0.65,
    arxivId: '2201.11903',
    collectionIds: ['c4', 'c_all'],
    fullTextSample: `**Chain-of-Thought Prompting**

We explore how generating a chain of thought—a series of intermediate reasoning steps—significantly improves the ability of large language models to perform complex reasoning.

Standard few-shot prompt:
    Q: Roger has 5 tennis balls. He buys 2 more cans of tennis balls. Each can has 3 balls. How many tennis balls does he have now?
    A: The answer is 11.

Chain-of-thought prompt:
    Q: Roger has 5 tennis balls. He buys 2 more cans of tennis balls. Each can has 3 balls. How many tennis balls does he have now?
    A: Roger started with 5 balls. 2 cans of 3 tennis balls each is 6 tennis balls. 5 + 6 = 11. The answer is 11.

The chain of thought is elicited purely through the format of the few-shot exemplars — no special training is required. The model generates the reasoning steps as part of its output.

**Emergent Ability**

Chain-of-thought reasoning is an emergent ability: it is not present in models below ~100B parameters and emerges abruptly above that scale. For PaLM 540B with chain-of-thought:

- GSM8K (math): 56.9% vs. 17.9% without chain-of-thought
- SVAMP (math): 79.0% vs. 65.0% without
- AQuA (algebra): 35.8% vs. 22.4% without
- StrategyQA (commonsense): 75.4% vs. 68.5% without

**Zero-Shot Chain-of-Thought**

A subsequent finding (Kojima et al., 2022) showed that simply appending "Let's think step by step." to the prompt elicits chain-of-thought reasoning without any few-shot examples, suggesting the reasoning pattern is latent in sufficiently large pretrained models.`,
    methods: [
      {
        name: 'Chain-of-Thought Prompting',
        type: 'approach',
        excerpt: 'Few-shot exemplars include intermediate reasoning steps before the final answer. No training required — emerges from few-shot context.',
        location: 'Section 2, p. 3–4',
        comparedTo: 'Standard few-shot prompting (direct answer only)',
        advantage: 'Enables complex multi-step reasoning; no additional parameters or training; works with any sufficiently large model.'
      }
    ],
    references: [
      { id: 'r17', title: 'Language Models are Few-Shot Learners', authors: ['Brown, T.', 'et al.'], year: 2020, journal: 'NeurIPS', inLibrary: true, paperId: 'p3' },
      { id: 'r18', title: 'Show Your Work: Scratchpads for Intermediate Computation', authors: ['Nye, M.', 'et al.'], year: 2021, journal: 'arXiv', inLibrary: false },
    ],
    codeRepos: []
  },
];

export const collections: Collection[] = [
  { id: 'c_all', name: 'All Papers', count: 8, icon: '◈', parentId: null, color: '#928ea8' },
  { id: 'c1', name: 'Transformer Architectures', count: 3, icon: '▷', parentId: null, color: '#a08ecf' },
  { id: 'c2', name: 'Pre-training Methods', count: 2, icon: '▷', parentId: null, color: '#6b9e8c' },
  { id: 'c3', name: 'Generative Models', count: 1, icon: '▷', parentId: null, color: '#c2975a' },
  { id: 'c4', name: 'Alignment & Reasoning', count: 2, icon: '▷', parentId: null, color: '#c26f6f' },
  { id: 'c5', name: 'Read Later', count: 2, icon: '◎', parentId: null, color: '#928ea8' },
];

export const graphNodes: GraphNode[] = [
  { id: 'p1', type: 'paper', label: 'Attention Is\nAll You Need', x: 500, y: 360, paperId: 'p1', year: 2017, citations: 89432, cluster: 'foundation' },
  { id: 'p2', type: 'paper', label: 'BERT', x: 310, y: 240, paperId: 'p2', year: 2018, citations: 71238, cluster: 'foundation' },
  { id: 'p3', type: 'paper', label: 'GPT-3', x: 700, y: 190, paperId: 'p3', year: 2020, citations: 38912, cluster: 'foundation' },
  { id: 'p4', type: 'paper', label: 'ViT', x: 760, y: 420, paperId: 'p4', year: 2020, citations: 31204, cluster: 'vision' },
  { id: 'p5', type: 'paper', label: 'DDPM', x: 260, y: 490, paperId: 'p5', year: 2020, citations: 19873, cluster: 'generation' },
  { id: 'p6', type: 'paper', label: 'CLIP', x: 620, y: 540, paperId: 'p6', year: 2021, citations: 25871, cluster: 'vision' },
  { id: 'p7', type: 'paper', label: 'InstructGPT\n(RLHF)', x: 880, y: 260, paperId: 'p7', year: 2022, citations: 14932, cluster: 'alignment' },
  { id: 'p8', type: 'paper', label: 'Chain-of-\nThought', x: 840, y: 460, paperId: 'p8', year: 2022, citations: 10843, cluster: 'alignment' },
  // Concepts
  { id: 'c_attn', type: 'concept', label: 'Self-Attention', x: 400, y: 390, cluster: 'foundation' },
  { id: 'c_pretrain', type: 'concept', label: 'Pre-training', x: 440, y: 240, cluster: 'foundation' },
  { id: 'c_scale', type: 'concept', label: 'Scaling Laws', x: 680, y: 90, cluster: 'foundation' },
  { id: 'c_contrast', type: 'concept', label: 'Contrastive\nLearning', x: 660, y: 630, cluster: 'vision' },
  // Methods
  { id: 'm_mha', type: 'method', label: 'Multi-Head\nAttention', x: 340, y: 360, cluster: 'foundation' },
  { id: 'm_rlhf', type: 'method', label: 'RLHF', x: 960, y: 200, cluster: 'alignment' },
  { id: 'm_cot', type: 'method', label: 'Chain of\nThought', x: 970, y: 420, cluster: 'alignment' },
];

export const graphEdges: GraphEdge[] = [
  { source: 'p2', target: 'p1', type: 'cites' },
  { source: 'p3', target: 'p1', type: 'cites' },
  { source: 'p4', target: 'p1', type: 'cites' },
  { source: 'p4', target: 'p2', type: 'cites' },
  { source: 'p6', target: 'p4', type: 'cites' },
  { source: 'p7', target: 'p3', type: 'cites' },
  { source: 'p8', target: 'p3', type: 'cites' },
  { source: 'p2', target: 'p3', type: 'semantic', weight: 0.82 },
  { source: 'p3', target: 'p7', type: 'semantic', weight: 0.71 },
  { source: 'p4', target: 'p6', type: 'semantic', weight: 0.74 },
  { source: 'p5', target: 'p6', type: 'semantic', weight: 0.48 },
  { source: 'p1', target: 'c_attn', type: 'shared-concept' },
  { source: 'p2', target: 'c_attn', type: 'shared-concept' },
  { source: 'p4', target: 'c_attn', type: 'shared-concept' },
  { source: 'p1', target: 'c_pretrain', type: 'shared-concept' },
  { source: 'p2', target: 'c_pretrain', type: 'shared-concept' },
  { source: 'p3', target: 'c_scale', type: 'shared-concept' },
  { source: 'p6', target: 'c_contrast', type: 'shared-concept' },
  { source: 'p5', target: 'c_contrast', type: 'shared-concept' },
  { source: 'p1', target: 'm_mha', type: 'shared-method' },
  { source: 'p2', target: 'm_mha', type: 'shared-method' },
  { source: 'p7', target: 'm_rlhf', type: 'shared-method' },
  { source: 'p8', target: 'm_cot', type: 'shared-method' },
];

export const notes: Note[] = [
  {
    id: 'n1',
    title: 'Notes on Scaled Dot-Product Attention',
    paperId: 'p1',
    content: 'The scaling by 1/√d_k counteracts the effect of large dot products in high-dimensional spaces — without it, the softmax would have extremely small gradients.\n\nWith d_k = 64 (as in the base model), √d_k = 8. The dot products can grow as large as d_k in expectation, so the scaling keeps them in a reasonable range.\n\nMulti-head with h=8 heads uses d_k = d_v = d_model/h = 512/8 = 64 per head. Each head can specialize to different subspaces.\n\nKey question to explore: does the choice of h interact with the depth L in a principled way?',
    date: '2024-11-01',
    tags: ['attention', 'transformers', 'math']
  },
  {
    id: 'n2',
    title: 'BERT vs GPT pre-training: structural comparison',
    paperId: null,
    content: 'BERT: bidirectional, masked LM (15% tokens). Best for understanding/classification tasks. Cannot generate autoregressively.\nGPT: autoregressive, left-to-right. Best for generation. Weaker on tasks requiring full bidirectional context.\n\nThe bidirectionality comes at a cost: BERT cannot be used as a generative model naively due to the masked token [MASK] not appearing at inference time.\n\nXLNet (2019) attempted to combine both: permutation-based training that allows autoregressive generation while considering full sequence context.',
    date: '2024-10-30',
    tags: ['BERT', 'GPT', 'comparison', 'pre-training']
  },
  {
    id: 'n3',
    title: 'DDPM forward process derivation',
    paperId: 'p5',
    content: 'The key insight enabling efficient training is that you can sample x_t from x_0 directly:\n\nq(x_t | x_0) = N(x_t; √ᾱ_t x_0, (1-ᾱ_t)I)\n\nThis means you do not need to run the full T-step chain — just one forward pass. You sample ε ~ N(0, I) and set:\n\nx_t = √ᾱ_t · x_0 + √(1-ᾱ_t) · ε\n\nThen the network learns to predict ε from (x_t, t). During inference, you iteratively apply the learned reverse transition starting from pure Gaussian noise.',
    date: '2024-10-25',
    tags: ['diffusion', 'DDPM', 'math', 'derivation']
  },
];

export const savedSearches: SavedSearch[] = [
  {
    id: 's1',
    name: 'Transformer attention mechanisms 2017–2022',
    query: 'transformer self-attention multi-head positional encoding',
    source: 'Semantic Scholar',
    date: '2024-11-03',
    count: 23,
    description: 'Core papers on transformer attention, positional encodings, and architectural variants.'
  },
  {
    id: 's2',
    name: 'Diffusion generative models: score matching',
    query: '(diffusion[Title/Abstract]) AND (probabilistic OR score matching OR denoising)',
    source: 'arXiv',
    date: '2024-10-28',
    count: 47,
    description: 'Score-based and diffusion probabilistic generative models since 2020.'
  },
  {
    id: 's3',
    name: 'RLHF and constitutional AI alignment',
    query: 'reinforcement learning human feedback language model alignment constitutional',
    source: 'PubMed + arXiv',
    date: '2024-10-15',
    count: 12,
    description: 'Methods for aligning LLMs with human preferences via feedback and constraints.'
  },
  {
    id: 's4',
    name: 'Emergent abilities large language models',
    query: 'emergent abilities capabilities large language models scale',
    source: 'Semantic Scholar',
    date: '2024-09-20',
    count: 18,
    description: 'Capabilities that emerge discontinuously with model scale.'
  }
];

export const projects: Project[] = [
  {
    id: 'proj1',
    name: 'Foundation Models Survey',
    description: 'Comprehensive review of transformer-based foundation models, pre-training paradigms, and downstream transfer.',
    paperCount: 8,
    noteCount: 3,
    lastModified: '2024-11-03',
    color: '#a08ecf',
    status: 'active'
  },
  {
    id: 'proj2',
    name: 'Alignment Methods Comparison',
    description: 'Systematic comparison of RLHF, Constitutional AI, DPO, and other alignment techniques.',
    paperCount: 4,
    noteCount: 1,
    lastModified: '2024-10-28',
    color: '#6b9e8c',
    status: 'active'
  },
  {
    id: 'proj3',
    name: 'Generative Vision Models',
    description: 'Diffusion models, GANs, and autoregressive approaches for image and video generation.',
    paperCount: 5,
    noteCount: 2,
    lastModified: '2024-09-15',
    color: '#c2975a',
    status: 'draft'
  },
];
