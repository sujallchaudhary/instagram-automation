const logger = require('../services/logger');
const agent = require('../agents/postCreator');
const sessionThreads = new Map();

const generateId = () => Math.random().toString(36).substring(7);

exports.renderIndex = (req, res) => {
    res.render('index', { errorMessage: null });
};

exports.generatePost = async (req, res) => {
    const topic = req.body.topic;
    if (!topic) {
        return res.render('index', { errorMessage: "Please provide a topic." });
    }
    const threadId = generateId();
    sessionThreads.set("current", threadId);

    logger.info(`[Controller] Starting generation for topic: "${topic}" (Thread: ${threadId})`);

    try {
        const config = { configurable: { thread_id: threadId } };
        const inputs = {
            topic: topic,
            iterations: 0
        };
        await agent.invoke(inputs, config);
        const snapshot = await agent.getState(config);
        const result = snapshot.values;

        if (!result.generated_content) {
            throw new Error("Agent did not generate content.");
        }

        logger.info(`[Controller] Generation paused for review.`);

        // Render Review Page with data from Agent State
        res.render('review', {
            data: {
                generatedCaption: result.generated_content,
                generatedHashtags: [],
                imagePrompt: result.image_prompt,
                imageUrl: result.image_url,
                topic: result.topic
            },
            errorMessage: null
        });

    } catch (error) {
        logger.error("Error generating post with agent:", error);
        res.render('index', { errorMessage: "Error generating post. Please try again." });
    }
};

exports.renderReview = async (req, res) => {
    const threadId = sessionThreads.get("current");
    if (!threadId) {
        return res.redirect('/');
    }

    try {
        const config = { configurable: { thread_id: threadId } };
        const snapshot = await agent.getState(config);
        const result = snapshot.values;

        if (!result.generated_content) {
            return res.redirect('/');
        }

        res.render('review', {
            data: {
                generatedCaption: result.generated_content,
                generatedHashtags: [],
                imagePrompt: result.image_prompt,
                imageUrl: result.image_url,
                topic: result.topic
            },
            errorMessage: null
        });
    } catch (e) {
        logger.error("Error retrieving state:", e);
        res.redirect('/');
    }
};

exports.handleDecision = async (req, res) => {
    const action = req.body.action;
    const threadId = sessionThreads.get("current");

    if (!threadId) {
        logger.error("No active thread found.");
        return res.redirect('/');
    }

    const config = { configurable: { thread_id: threadId } };

    if (action === 'approve') {
        logger.info(`[Controller] User approved post. Resuming agent...`);
        try {
            await agent.updateState(config, { approved: true, feedback: "" });
            await agent.invoke(null, config);
            const snapshot = await agent.getState(config);
            return res.render('success', {
                imageUrl: snapshot.values.image_url,
                caption: snapshot.values.generated_content
            });

        } catch (error) {
            logger.error("Error processing approval:", error);
            const snapshot = await agent.getState(config);
            return res.render('review', {
                data: {
                    generatedCaption: snapshot.values.generated_content,
                    imagePrompt: snapshot.values.image_prompt,
                    imageUrl: snapshot.values.image_url,
                    topic: snapshot.values.topic
                },
                errorMessage: "Failed to publish. See logs."
            });
        }

    } else if (action === 'revise') {
        const feedback = req.body.feedback;
        logger.info(`[Controller] User requested revision: "${feedback}". Resuming agent...`);

        try {
            await agent.updateState(config, { approved: false, feedback: feedback });
            await agent.invoke(null, config);
            const snapshot = await agent.getState(config);
            const result = snapshot.values;
            res.render('review', {
                data: {
                    generatedCaption: result.generated_content,
                    generatedHashtags: [],
                    imagePrompt: result.image_prompt,
                    imageUrl: result.image_url,
                    topic: result.topic
                },
                errorMessage: null
            });

        } catch (error) {
            logger.error("Error revising post:", error);
            const snapshot = await agent.getState(config);
            return res.render('review', {
                data: {
                    generatedCaption: snapshot?.values?.generated_content,
                    generatedHashtags: [],
                    imagePrompt: snapshot?.values?.image_prompt,
                    imageUrl: snapshot?.values?.image_url,
                    topic: snapshot?.values?.topic
                },
                errorMessage: "Error revising post."
            });
        }

    } else {
        res.redirect('/');
    }
};
